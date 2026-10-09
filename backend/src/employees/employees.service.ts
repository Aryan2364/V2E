import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { classifyIdentifier, resolvePhoneForSave } from '../common/identifier.util';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { LearningService } from '../learning/learning.service';
import { AssigneeVisibilityService } from '../assignee-visibility/assignee-visibility.service';

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  country_code: true,
  phone: true,
  is_active: true,
  created_at: true,
};

const PROFILE_INCLUDE = {
  user: { select: USER_SELECT },
  role: { select: { id: true, title: true, level: true, job_description: true, kra: true } },
  system_role: { select: { id: true, name: true, is_system: true } },
  department: { select: { id: true, name: true } },
  reporting_to: { select: USER_SELECT },
};

/**
 * Marks the one delete refusal the admin is allowed to overrule: dangling
 * reporting lines and headships. The confirm dialog keys off this code to offer
 * "delete anyway" — every other refusal (self, primary admin, real records) has
 * no override and must stay a plain message.
 */
export const DELETE_BLOCKED_BY_DEPENDENTS = 'DELETE_BLOCKED_BY_DEPENDENTS';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => LearningService))
    private readonly learningService: LearningService,
    private readonly assigneeVisibility: AssigneeVisibilityService,
    private readonly mail: MailService,
  ) {}

  async findAll(orgId: string) {
    return this.prisma.employeeProfile.findMany({
      where: { organization_id: orgId },
      include: PROFILE_INCLUDE,
      orderBy: { created_at: 'asc' },
    });
  }

  async findOne(id: string, orgId: string) {
    const profile = await this.prisma.employeeProfile.findFirst({
      where: { id, organization_id: orgId },
      include: PROFILE_INCLUDE,
    });

    if (!profile) {
      throw new NotFoundException(`Employee ${id} not found in this organization`);
    }

    // Build reporting chain up to 5 levels using a recursive query to avoid N+1 sequential DB calls
    const chainIds: { user_id: string }[] = await this.prisma.$queryRaw`
      WITH RECURSIVE reporting_chain AS (
        SELECT user_id, reporting_to_user_id, 1 as depth
        FROM employee_profiles
        WHERE user_id = ${profile.user_id} AND organization_id = ${orgId}
        UNION ALL
        SELECT p.user_id, p.reporting_to_user_id, rc.depth + 1
        FROM employee_profiles p
        INNER JOIN reporting_chain rc ON p.user_id = rc.reporting_to_user_id
        WHERE rc.depth < 5 AND p.organization_id = ${orgId}
      )
      SELECT user_id FROM reporting_chain WHERE user_id <> ${profile.user_id} ORDER BY depth ASC;
    `;

    const userIds = chainIds.map((c) => c.user_id);
    let reportingChain: any[] = [];

    if (userIds.length > 0) {
      const managers = await this.prisma.employeeProfile.findMany({
        where: { user_id: { in: userIds }, organization_id: orgId },
        include: {
          user: { select: USER_SELECT },
          role: { select: { id: true, title: true, level: true } },
          department: { select: { id: true, name: true } },
        },
      });

      const managerMap = new Map(managers.map((m) => [m.user_id, m.user]));
      reportingChain = userIds.map((uid) => managerMap.get(uid)).filter(Boolean);
    }

    return { ...profile, reporting_chain: reportingChain };
  }

  /**
   * Does a global login already exist for this email OR phone? Drives the Add-Employee
   * form: an existing account is added to this firm WITHOUT a new password (they keep
   * the one login they use everywhere). Returns the existing name so the form can lock
   * it, whether they're already an employee HERE (duplicate block), and how many orgs
   * they belong to (for the "changes their password everywhere" messaging). Deliberately
   * does NOT reveal which other firms — only the count. Admin-gated at the controller.
   */
  async checkAccount(orgId: string, identifier: string, countryCode?: string) {
    const classified = classifyIdentifier(identifier, countryCode);
    if (!classified.value) return { exists: false };
    const user = await this.prisma.user.findUnique({
      where:
        classified.kind === 'email'
          ? { email: classified.value }
          : { country_code_phone: { country_code: classified.countryCode, phone: classified.value } },
      select: { id: true, name: true },
    });
    if (!user) return { exists: false };
    const [profileHere, orgCount] = await Promise.all([
      this.prisma.employeeProfile.findFirst({
        where: { user_id: user.id, organization_id: orgId },
        select: { id: true },
      }),
      this.prisma.organizationMember.count({
        where: { user_id: user.id, is_active: true },
      }),
    ]);
    return {
      exists: true,
      name: user.name,
      already_in_org: !!profileHere,
      org_count: orgCount,
    };
  }

  async create(orgId: string, dto: CreateEmployeeDto) {
    // Pull the login-identity fields OUT of profileData — they belong to the User,
    // not the EmployeeProfile (which has no email/phone/country_code columns).
    const { name, password, make_dep_head, email: _e, phone: _p, country_code: _c, ...profileData } = dto;
    // Login identity: email OR phone — at least one is required. The phone is
    // validated + normalised for its country, and stored as a (country_code, phone)
    // pair (or both NULL). At least one of email/phone must resolve to a value.
    const email = dto.email?.trim() || null;
    const { country_code, phone } = resolvePhoneForSave(dto.country_code, dto.phone);
    if (!email && !phone) {
      throw new BadRequestException('Enter an email address or a phone number (at least one is required).');
    }

    const roleExists = await this.prisma.role.findFirst({
      where: { id: profileData.role_id, organization_id: orgId },
    });

    if (!roleExists) {
      throw new NotFoundException(
        `Role ${profileData.role_id} not found in this organization`,
      );
    }

    const deptExists = await this.prisma.department.findFirst({
      where: { id: profileData.department_id, organization_id: orgId },
    });

    if (!deptExists) {
      throw new NotFoundException(
        `Department ${profileData.department_id} not found in this organization`,
      );
    }

    if (profileData.system_role_id) {
      const systemRoleExists = await this.prisma.systemRole.findFirst({
        where: { id: profileData.system_role_id, organization_id: orgId },
        select: { id: true, is_admin: true },
      });
      if (!systemRoleExists) {
        throw new NotFoundException(
          `System role ${profileData.system_role_id} not found in this organization`,
        );
      }
      // An admin must be reachable by email — a phone-only person can't be given an
      // admin System Role.
      if (systemRoleExists.is_admin && !email) {
        throw new BadRequestException(
          'An admin must always have an email address, so their team can recover access.',
        );
      }
    }

    // Employee codes must be unique within the organization.
    const code = profileData.employee_code?.trim();
    if (code) {
      const codeClash = await this.prisma.employeeProfile.findFirst({
        where: { organization_id: orgId, employee_code: code },
        select: { id: true },
      });
      if (codeClash) {
        throw new ConflictException(
          `Employee code '${code}' is already in use in this organization`,
        );
      }
    }

    const { profile, createdUserId, userWasCreated } = await this.prisma.$transaction(async (tx) => {
      // Find an existing global login by email and/or phone-pair (either identifies them).
      const [userByEmail, userByPhone] = await Promise.all([
        email ? tx.user.findUnique({ where: { email } }) : Promise.resolve(null),
        phone
          ? tx.user.findUnique({ where: { country_code_phone: { country_code: country_code!, phone } } })
          : Promise.resolve(null),
      ]);
      if (userByEmail && userByPhone && userByEmail.id !== userByPhone.id) {
        throw new ConflictException(
          'That email and phone number belong to two different people. Use one that identifies a single person.',
        );
      }
      let user = userByEmail ?? userByPhone;
      let isExistingMember = false;
      let userWasCreated = false;
      if (user) {
        const existingProfile = await tx.employeeProfile.findFirst({
          where: { user_id: user.id, organization_id: orgId },
        });
        if (existingProfile) {
          throw new ConflictException(
            `${user.name} already has an employee profile in this organization`,
          );
        }
        const member = await tx.organizationMember.findFirst({
          where: { user_id: user.id, organization_id: orgId },
        });
        isExistingMember = !!member;
        // Existing global account: we NEVER set/overwrite its password, name, email or
        // phone here. The person keeps the one login they already use across their other
        // firms; this firm only adds a membership + profile. (Password can still be reset
        // later from the edit screen, which warns it changes their login everywhere.)
        //
        // Issue #5: if a phone was typed but it isn't already this person's number, it
        // would otherwise be silently dropped. Stop and tell the admin plainly, rather
        // than pretend it was saved. (A matching number is harmless — it just re-identified
        // them — so only a DIFFERENT number is blocked.)
        if (phone && (user.country_code !== country_code || user.phone !== phone)) {
          throw new ConflictException(
            `${user.name} already has a V2E login, so the phone number you entered was NOT applied. ` +
              `Add them without it, then set their number from their profile → Edit.`,
          );
        }
      } else {
        // Brand-new account — a password is required to create the login.
        if (!password || password.length < 8) {
          throw new BadRequestException(
            'A password (min 8 characters) is required to create a new user account.',
          );
        }
        const password_hash = await bcrypt.hash(password, 12);
        user = await tx.user.create({
          data: { name, email, country_code, phone, password_hash, is_active: true },
        });
        userWasCreated = true;
      }

      if (!isExistingMember) {
        await tx.organizationMember.create({
          data: { organization_id: orgId, user_id: user.id, is_admin: false },
        });
      }

      const profile = await tx.employeeProfile.create({
        data: {
          ...profileData,
          organization_id: orgId,
          user_id: user.id,
          date_of_joining: profileData.date_of_joining ? new Date(profileData.date_of_joining) : undefined,
          date_of_birth: profileData.date_of_birth ? new Date(profileData.date_of_birth) : undefined,
          marriage_date: profileData.marriage_date ? new Date(profileData.marriage_date) : undefined,
        },
        include: PROFILE_INCLUDE,
      });

      if (make_dep_head) {
        const dept = await tx.department.findUnique({
          where: { id: profileData.department_id },
          select: { head_user_id: true },
        });
        if (dept && !dept.head_user_id) {
          await tx.department.update({
            where: { id: profileData.department_id },
            data: { head_user_id: user.id },
          });
        }
      }

      return { profile, createdUserId: user.id, userWasCreated };
    });

    // Auto-assign published learning paths after transaction commits
    await this.learningService.autoAssignForNewEmployee(
      profile.id,
      profileData.role_id,
      orgId,
      createdUserId,
      profileData.department_id,
    );

    this.assigneeVisibility.invalidate(orgId);

    // Welcome the employee — best-effort, never fail creation on a mail error.
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { name: true },
      });
      const firmName = org?.name ?? 'your organisation';
      // Only email-able when they actually have an email (phone-only accounts don't).
      if (email) {
        if (userWasCreated) {
          // password is guaranteed present here — new accounts are validated above.
          await this.mail.sendWelcomeCredentials({ to: email, name, firmName, password: password! });
        } else {
          await this.mail.sendAddedToFirm({ to: email, name, firmName });
        }
      }
    } catch {
      /* MailService logs failures; swallow so the employee is still created. */
    }

    return profile;
  }

  async update(id: string, orgId: string, dto: UpdateEmployeeDto) {
    const profile = await this.findOne(id, orgId);

    if (dto.role_id) {
      const roleExists = await this.prisma.role.findFirst({
        where: { id: dto.role_id, organization_id: orgId },
      });
      if (!roleExists) {
        throw new NotFoundException(
          `Role ${dto.role_id} not found in this organization`,
        );
      }
    }

    if (dto.department_id) {
      const deptExists = await this.prisma.department.findFirst({
        where: { id: dto.department_id, organization_id: orgId },
      });
      if (!deptExists) {
        throw new NotFoundException(
          `Department ${dto.department_id} not found in this organization`,
        );
      }
    }

    if (dto.system_role_id) {
      const systemRoleExists = await this.prisma.systemRole.findFirst({
        where: { id: dto.system_role_id, organization_id: orgId },
        select: { id: true, is_admin: true },
      });
      if (!systemRoleExists) {
        throw new NotFoundException(
          `System role ${dto.system_role_id} not found in this organization`,
        );
      }
      // Promoting to an admin System Role requires an email (team can recover access).
      if (systemRoleExists.is_admin && !profile.user?.email) {
        throw new BadRequestException(
          'An admin must always have an email address, so their team can recover access.',
        );
      }
    }

    const updated = await this.prisma.employeeProfile.update({
      where: { id },
      data: {
        ...dto,
        date_of_joining: dto.date_of_joining ? new Date(dto.date_of_joining) : undefined,
        date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : undefined,
        marriage_date: dto.marriage_date ? new Date(dto.marriage_date) : undefined,
      },
      include: PROFILE_INCLUDE,
    });
    // Role/department/manager changes affect who appears in pickers.
    this.assigneeVisibility.invalidate(orgId);
    return updated;
  }

  async updateStatus(id: string, orgId: string, status: EmployeeStatus) {
    const profile = await this.prisma.employeeProfile.findFirst({
      where: { id, organization_id: orgId },
    });

    if (!profile) {
      throw new NotFoundException(`Employee ${id} not found in this organization`);
    }

    if (status === 'inactive') {
      const primaryAdmin = await this.prisma.organizationMember.findFirst({
        where: { organization_id: orgId, is_admin: true },
        orderBy: { joined_at: 'asc' },
      });
      if (primaryAdmin && profile.user_id === primaryAdmin.user_id) {
        throw new BadRequestException(
          'The primary administrator of this organization cannot be deactivated.',
        );
      }
    }

    const updated = await this.prisma.employeeProfile.update({
      where: { id },
      data: { status },
      include: PROFILE_INCLUDE,
    });
    // Only active employees appear in pickers — status change affects the pool.
    this.assigneeVisibility.invalidate(orgId);
    return updated;
  }

  /**
   * Hard-delete an employee. Only a "clean" profile can be removed — anyone who
   * still owns work, has reports, or heads a department is blocked and should be
   * DEACTIVATED instead (which preserves their history). What's removed:
   *   • the HR profile + this org's membership, always;
   *   • the underlying login/User too, but ONLY if it's used nowhere else on the
   *     platform (no other org membership/profile and no remaining data — the
   *     latter enforced by the DB foreign keys, which roll the delete back).
   * Self and the primary administrator are protected.
   */
  /**
   * "Sales", "Sales and Ops", "Sales, Ops and 3 more" — a blocking message is only
   * actionable if it says WHICH records are in the way, but it shouldn't run to a
   * paragraph either, so long lists are trimmed.
   */
  private nameList(names: (string | null | undefined)[], max = 3): string {
    const clean = names.filter((n): n is string => !!n && n.trim().length > 0);
    if (clean.length === 0) return 'unnamed';
    const shown = clean.slice(0, max);
    const rest = clean.length - shown.length;
    if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
    if (shown.length === 1) return shown[0];
    return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  }

  async remove(
    id: string,
    orgId: string,
    actingUserId: string,
    detachDependents = false,
  ) {
    const profile = await this.prisma.employeeProfile.findFirst({
      where: { id, organization_id: orgId },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!profile) {
      throw new NotFoundException(`Employee ${id} not found in this organization`);
    }

    if (profile.user_id === actingUserId) {
      throw new BadRequestException(
        "You can't delete your own account. Ask another administrator to do it.",
      );
    }

    const primaryAdmin = await this.prisma.organizationMember.findFirst({
      where: { organization_id: orgId, is_admin: true },
      orderBy: { joined_at: 'asc' },
    });
    if (primaryAdmin && profile.user_id === primaryAdmin.user_id) {
      throw new BadRequestException(
        'The primary administrator of this organization cannot be deleted.',
      );
    }

    // Two things would be left dangling by the delete: people who report to this
    // person, and departments they head. Neither is a data-integrity problem — a
    // manager-less employee and a headless department are both legal states — so
    // this is the admin's call, not ours. We refuse the FIRST attempt and hand back
    // exactly what's in the way (named, with ids), so the confirm dialog can offer
    // to clear them; `detachDependents` is the admin saying yes to that.
    const [reports, headed] = await Promise.all([
      this.prisma.employeeProfile.findMany({
        where: { organization_id: orgId, reporting_to_user_id: profile.user_id },
        select: { id: true, user: { select: { name: true } } },
        orderBy: { created_at: 'asc' },
      }),
      this.prisma.department.findMany({
        where: { organization_id: orgId, head_user_id: profile.user_id },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    if (!detachDependents && (reports.length > 0 || headed.length > 0)) {
      const parts: string[] = [];
      if (reports.length > 0) {
        parts.push(
          `${reports.length} ${reports.length === 1 ? 'person reports' : 'people report'} to them ` +
            `(${this.nameList(reports.map((r) => r.user?.name))})`,
        );
      }
      if (headed.length > 0) {
        parts.push(
          `they head ${headed.length} department${headed.length === 1 ? '' : 's'} ` +
            `(${this.nameList(headed.map((d) => d.name))})`,
        );
      }
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: DELETE_BLOCKED_BY_DEPENDENTS,
        message:
          `Can't delete yet — ${parts.join(', and ')}. ` +
          'Reassign them first, or confirm to clear these links and delete anyway.',
        blockers: {
          reports: reports.map((r) => ({ id: r.id, name: r.user?.name ?? 'Unnamed' })),
          departments: headed.map((d) => ({ id: d.id, name: d.name })),
        },
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Override: the admin accepted manager-less reports and headless
        // departments. Clear those links inside the same transaction, so a delete
        // that later fails on a foreign key rolls the unlinking back too.
        if (detachDependents) {
          if (reports.length > 0) {
            await tx.employeeProfile.updateMany({
              where: { organization_id: orgId, reporting_to_user_id: profile.user_id },
              data: { reporting_to_user_id: null },
            });
          }
          if (headed.length > 0) {
            await tx.department.updateMany({
              where: { organization_id: orgId, head_user_id: profile.user_id },
              data: { head_user_id: null },
            });
          }
        }

        // Things ASSIGNED TO this person — learning paths, company policies — are
        // part of their profile, not company history, so they go with it. Records
        // they actually produced (tasks, meetings, goals) are a different matter:
        // those stay foreign-key protected below and still block the delete.
        await tx.learningPathAssignment.deleteMany({ where: { employee_profile_id: id } });
        await tx.companyPolicyAssignment.deleteMany({ where: { employee_profile_id: id } });

        // Deleting the profile still trips a foreign key if any OTHER dependent
        // record points at it — that rolls the whole transaction back and we
        // translate it to a friendly message.
        await tx.employeeProfile.delete({ where: { id } });
        await tx.organizationMember.deleteMany({
          where: { organization_id: orgId, user_id: profile.user_id },
        });

        // Keep the login if it's used anywhere else; otherwise remove it too.
        const [otherProfiles, otherMemberships] = await Promise.all([
          tx.employeeProfile.count({ where: { user_id: profile.user_id } }),
          tx.organizationMember.count({ where: { user_id: profile.user_id } }),
        ]);
        if (otherProfiles === 0 && otherMemberships === 0) {
          // FK-guarded: throws P2003 (→ rollback) if the user still owns work.
          await tx.user.delete({ where: { id: profile.user_id } });
        }
      });
    } catch (e: any) {
      // A foreign-key refusal reaches us in more than one shape: Prisma's own
      // P2003, and — since the pg driver adapter — a raw DriverAdapterError whose
      // message carries the constraint. Matching only P2003 let the second kind
      // escape as a bare 500 instead of the plain-language reason.
      const msg = String(e?.message ?? '');
      const isForeignKeyRefusal =
        e?.code === 'P2003' ||
        e?.code === '23503' ||
        /foreign key constraint|violates RESTRICT/i.test(msg);
      if (isForeignKeyRefusal) {
        throw new BadRequestException(
          'This person has records on the system (tasks, meetings, goals, and the like). ' +
            'Deactivate them instead to keep that history.',
        );
      }
      throw e;
    }

    this.assigneeVisibility.invalidate(orgId);
    return { message: 'Employee deleted successfully' };
  }

  // ─── Self-service ────────────────────────────────────────────────────────────────

  /** The caller's own profile (resolved from their user id), with reporting chain. */
  async findMine(orgId: string, userId: string) {
    const profile = await this.prisma.employeeProfile.findFirst({
      where: { organization_id: orgId, user_id: userId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException('You do not have an employee profile in this organization');
    }
    return this.findOne(profile.id, orgId);
  }

  /**
   * Self-edit of PERSONAL fields only. Org-structural fields (role, department,
   * manager, employment type, status) are intentionally not editable here.
   */
  async updateMine(
    orgId: string,
    userId: string,
    dto: { date_of_birth?: string | null; marriage_date?: string | null },
  ) {
    const profile = await this.prisma.employeeProfile.findFirst({
      where: { organization_id: orgId, user_id: userId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException('You do not have an employee profile in this organization');
    }
    const data: { date_of_birth?: Date | null; marriage_date?: Date | null } = {};
    if (dto.date_of_birth !== undefined) {
      data.date_of_birth = dto.date_of_birth ? new Date(dto.date_of_birth) : null;
    }
    if (dto.marriage_date !== undefined) {
      data.marriage_date = dto.marriage_date ? new Date(dto.marriage_date) : null;
    }
    return this.prisma.employeeProfile.update({
      where: { id: profile.id },
      data,
      include: PROFILE_INCLUDE,
    });
  }

  async getPeopleEvents(orgId: string, windowDays = 30) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + windowDays);

    const pad = (n: number) => String(n).padStart(2, '0');
    const startMMDD = `${pad(today.getMonth() + 1)}${pad(today.getDate())}`;
    const endMMDD = `${pad(windowEnd.getMonth() + 1)}${pad(windowEnd.getDate())}`;

    const dateCondition = (col: string) => {
      if (startMMDD <= endMMDD) {
        return `${col} IS NOT NULL AND TO_CHAR(${col}, 'MMDD') BETWEEN '${startMMDD}' AND '${endMMDD}'`;
      } else {
        return `${col} IS NOT NULL AND (TO_CHAR(${col}, 'MMDD') >= '${startMMDD}' OR TO_CHAR(${col}, 'MMDD') <= '${endMMDD}')`;
      }
    };

    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Query database-filtered matches to avoid fetching all employees into JS memory
    const profiles = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        ep.id,
        ep.user_id,
        ep.date_of_birth,
        ep.marriage_date,
        ep.date_of_joining,
        u.name,
        u.email
      FROM employee_profiles ep
      INNER JOIN users u ON ep.user_id = u.id
      WHERE ep.organization_id = $1 AND ep.status = 'active'
        AND (
          (${dateCondition('ep.date_of_birth')})
          OR (${dateCondition('ep.marriage_date')})
          OR (${dateCondition('ep.date_of_joining')})
          OR (ep.date_of_joining IS NOT NULL AND ep.date_of_joining > $2 AND ep.date_of_joining <= $3)
        );
    `, orgId, thirtyDaysAgo, today);

    // Returns the next calendar occurrence of a month/day on or after today
    function nextOccurrence(month: number, day: number): Date {
      const thisYear = new Date(today.getFullYear(), month - 1, day);
      if (thisYear >= today) return thisYear;
      return new Date(today.getFullYear() + 1, month - 1, day);
    }

    function ordinal(n: number): string {
      const s = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    function formatDate(d: Date): string {
      return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    }

    const birthdays: any[] = [];
    const anniversaries: any[] = [];
    const newHirings: any[] = [];
    const workAnniversaries: any[] = [];

    for (const p of profiles) {
      const base = {
        user_id: p.user_id,
        name: p.name,
        avatar_url: null,
      };

      // Birthdays
      if (p.date_of_birth) {
        const dob = new Date(p.date_of_birth);
        const m = dob.getMonth() + 1;
        const d = dob.getDate();
        const next = nextOccurrence(m, d);
        if (next <= windowEnd) {
          const isToday = next.getTime() === today.getTime();
          birthdays.push({
            ...base,
            event_date: next.toISOString().split('T')[0],
            label: isToday ? 'Birthday Today' : `Birthday · ${formatDate(next)}`,
          });
        }
      }

      // Marriage anniversaries
      if (p.marriage_date) {
        const mDate = new Date(p.marriage_date);
        const m = mDate.getMonth() + 1;
        const d = mDate.getDate();
        const next = nextOccurrence(m, d);
        if (next <= windowEnd) {
          const years = next.getFullYear() - mDate.getFullYear();
          const isToday = next.getTime() === today.getTime();
          anniversaries.push({
            ...base,
            event_date: next.toISOString().split('T')[0],
            label: isToday
              ? `${ordinal(years)} Anniversary Today`
              : `${ordinal(years)} Anniversary · ${formatDate(next)}`,
            years,
          });
        }
      }

      // New hirings — joined in the last 30 days
      if (p.date_of_joining) {
        const doj = new Date(p.date_of_joining);
        if (doj > thirtyDaysAgo && doj <= today) {
          const diffDays = Math.floor((today.getTime() - doj.getTime()) / 86400000);
          newHirings.push({
            ...base,
            event_date: doj.toISOString().split('T')[0],
            label: diffDays === 0 ? 'Joined Today' : `Joined ${diffDays} day${diffDays !== 1 ? 's' : ''} ago`,
          });
        }
      }

      // Work anniversaries
      if (p.date_of_joining) {
        const doj = new Date(p.date_of_joining);
        const m = doj.getMonth() + 1;
        const d = doj.getDate();
        const next = nextOccurrence(m, d);
        const years = next.getFullYear() - doj.getFullYear();
        if (next <= windowEnd && years >= 1) {
          const isToday = next.getTime() === today.getTime();
          workAnniversaries.push({
            ...base,
            event_date: next.toISOString().split('T')[0],
            label: isToday
              ? `${ordinal(years)} Work Anniversary Today`
              : `${ordinal(years)} Work Anniversary · ${formatDate(next)}`,
            years,
          });
        }
      }
    }

    // Sort each list by event_date ascending
    const byDate = (a: any, b: any) => a.event_date.localeCompare(b.event_date);
    birthdays.sort(byDate);
    anniversaries.sort(byDate);
    workAnniversaries.sort(byDate);
    // New hirings: most recent first
    newHirings.sort((a, b) => b.event_date.localeCompare(a.event_date));

    return { birthdays, anniversaries, new_hirings: newHirings, work_anniversaries: workAnniversaries };
  }

  async getReportingTree(orgId: string) {
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { organization_id: orgId },
      include: {
        user: { select: USER_SELECT },
        role: { select: { id: true, title: true, level: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    return profiles.map((p) => ({
      id: p.id,
      user_id: p.user_id,
      name: p.user.name,
      email: p.user.email,
      role: p.role,
      department: p.department,
      reporting_to_user_id: p.reporting_to_user_id,
      status: p.status,
      employment_type: p.employment_type,
      employee_code: p.employee_code,
    }));
  }
}
