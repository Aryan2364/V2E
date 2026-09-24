import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataScope, EntitlementState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { classifyIdentifier, resolvePhoneForSave } from '../common/identifier.util';
import { CreateOrgWithAdminDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateEntitlementsDto } from './dto/update-entitlements.dto';
import {
  ENTITLEMENT_UNITS,
  ENTITLEMENT_MODULE_KEYS,
  ENTITLEMENT_DEFAULT_BY_KEY,
  GOVERNANCE_ENTITLEMENT_KEYS,
  LEGACY_GOVERNANCE_KEY,
} from '../access-rights/permission-registry';
import { seedDefaultSystemRoles } from '../access-rights/default-system-roles';
import { seedTaskMasters } from '../task-masters/seed-task-masters';

// Every sellable entitlement unit for the super-admin portal. Governance is
// expanded into its per-line-item units (each with a `group` for the portal).
const ENTITLEMENT_MODULES = ENTITLEMENT_UNITS.map((u) => ({
  key: u.key,
  label: u.label,
  group: u.group,
}));

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async findAll() {
    return this.prisma.organization.findMany({
      include: {
        _count: { select: { members: true, departments: true } },
        group: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        _count: { select: { members: true, departments: true } },
        org_identity: true,
        group: { select: { id: true, name: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true, country_code: true, phone: true, is_active: true } } },
          orderBy: { joined_at: 'asc' },
        },
      },
    });

    if (!org) throw new NotFoundException(`Organization with id ${id} not found`);

    // Enrich members with their other org memberships (also_in)
    const enrichedMembers = await Promise.all(
      org.members.map(async (m) => {
        const otherMemberships = await this.prisma.organizationMember.findMany({
          where: { user_id: m.user_id, organization_id: { not: id }, is_active: true },
          include: { organization: { select: { id: true, name: true } } },
        });
        return { ...m, also_in: otherMemberships.map((om) => om.organization) };
      }),
    );

    return { ...org, members: enrichedMembers };
  }

  /**
   * Lightweight, member-safe view of a single org. Unlike findOne (super-admin
   * only, returns the full member roster + cross-org memberships), this returns
   * just the public-facing org profile so any member can render their own
   * dashboard header. Scope is enforced by OrgScopeGuard at the controller.
   */
  async findSummary(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        logo_url: true,
        industry: true,
        country: true,
        timezone: true,
        status: true,
        group: { select: { id: true, name: true } },
      },
    });

    if (!org) throw new NotFoundException(`Organization with id ${id} not found`);

    return { ...org, entitlements: await this.entitlementMap(id) };
  }

  // ─── Module entitlements (vendor ceiling — superadmin only) ───────────────────

  /** Full entitlement list for the superadmin portal: every controlled module + its state. */
  async getEntitlements(orgId: string) {
    const rows = await this.prisma.orgModuleEntitlement.findMany({
      where: { organization_id: orgId },
    });
    const byKey = new Map(rows.map((r) => [r.module_key, r.state]));
    // Governance line items inherit the legacy `governance` state until saved.
    const govFallback = byKey.get(LEGACY_GOVERNANCE_KEY);
    const resolve = (key: string): EntitlementState =>
      byKey.get(key) ??
      (GOVERNANCE_ENTITLEMENT_KEYS.includes(key) ? govFallback : undefined) ??
      EntitlementState.off;
    return {
      modules: ENTITLEMENT_MODULES.map((m) => ({
        module_key: m.key,
        label: m.label,
        group: m.group,
        state: resolve(m.key),
      })),
    };
  }

  /** Member-safe map module_key → state, used to drive in-app nav/feature gating. */
  async entitlementMap(orgId: string): Promise<Record<string, EntitlementState>> {
    const rows = await this.prisma.orgModuleEntitlement.findMany({
      where: { organization_id: orgId },
    });
    const map: Record<string, EntitlementState> = {};
    for (const key of ENTITLEMENT_MODULE_KEYS) map[key] = EntitlementState.off;
    for (const r of rows) map[r.module_key] = r.state;
    // Governance split into per-line-item keys; existing orgs only stored the
    // legacy `governance` row. Inherit it for any line item without an explicit
    // row so nav/feature gating works before the first super-admin save.
    const govFallback = map[LEGACY_GOVERNANCE_KEY];
    if (govFallback) {
      const explicit = new Set(rows.map((r) => r.module_key));
      for (const key of GOVERNANCE_ENTITLEMENT_KEYS) {
        if (!explicit.has(key)) map[key] = govFallback;
      }
    }
    return map;
  }

  async setEntitlements(orgId: string, actorId: string, dto: UpdateEntitlementsDto) {
    const valid = new Set(ENTITLEMENT_MODULE_KEYS);
    for (const e of dto.entries) {
      if (!valid.has(e.module_key)) {
        throw new BadRequestException(`Unknown module "${e.module_key}"`);
      }
    }
    for (const e of dto.entries) {
      await this.prisma.orgModuleEntitlement.upsert({
        where: { organization_id_module_key: { organization_id: orgId, module_key: e.module_key } },
        create: { organization_id: orgId, module_key: e.module_key, state: e.state, updated_by_user_id: actorId },
        update: { state: e.state, updated_by_user_id: actorId },
      });
    }
    return this.getEntitlements(orgId);
  }

  /**
   * Seed all controlled modules for an org (new orgs + backfill). Idempotent —
   * only fills in missing rows, never overwrites an existing state. When `state`
   * is omitted each module seeds to its per-key default (most `full`; opt-out
   * modules like Delegation seed `off`); pass a state to force them all alike.
   */
  async seedEntitlements(orgId: string, state?: EntitlementState) {
    for (const key of ENTITLEMENT_MODULE_KEYS) {
      const seed = state ?? ((ENTITLEMENT_DEFAULT_BY_KEY[key] ?? 'full') as EntitlementState);
      await this.prisma.orgModuleEntitlement.upsert({
        where: { organization_id_module_key: { organization_id: orgId, module_key: key } },
        create: { organization_id: orgId, module_key: key, state: seed },
        update: {},
      });
    }
  }

  /**
   * Turn an org name into a URL-safe slug and ensure it's unique by appending
   * a numeric suffix (`acme-corp`, `acme-corp-2`, …) on collision.
   */
  private async generateUniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'org';

    let candidate = base;
    let n = 2;
    // eslint-disable-next-line no-await-in-loop
    while (await this.prisma.organization.findUnique({ where: { slug: candidate } })) {
      candidate = `${base}-${n++}`;
    }
    return candidate;
  }

  /**
   * Does a global login already exist for this email? Lets the firm-creation form
   * show a password field ONLY for a brand-new admin, and none for an existing login
   * (who keeps their password). Returns the existing name so the form can lock it.
   */
  async checkAccount(identifier: string, countryCode?: string) {
    const classified = classifyIdentifier(identifier, countryCode);
    if (!classified.value) return { exists: false };
    const user = await this.prisma.user.findUnique({
      where:
        classified.kind === 'email'
          ? { email: classified.value }
          : { country_code_phone: { country_code: classified.countryCode, phone: classified.value } },
      select: { name: true },
    });
    return user ? { exists: true, name: user.name } : { exists: false };
  }

  async create(dto: CreateOrgWithAdminDto) {
    const {
      admin_name,
      admin_email: rawEmail,
      admin_phone: rawPhone,
      admin_country_code: rawCountryCode,
      admin_password,
      existing_user_id,
      ...orgData
    } = dto;
    // Admin login identity: email OR phone (at least one), unless picking an existing user by id.
    // The phone is validated + normalised into a (country_code, phone) pair, or both NULL.
    const admin_email = rawEmail?.trim() || null;
    const { country_code: admin_country_code, phone: admin_phone } = resolvePhoneForSave(rawCountryCode, rawPhone);

    if (!existing_user_id && !admin_email) {
      // An org admin must be reachable by email (team can recover access) — a phone
      // alone is not enough for the person who administers the firm.
      throw new UnprocessableEntityException('An organization admin must have an email address, so their team can recover access.');
    }

    // Slug is an internal identifier — derive it from the name and guarantee uniqueness.
    const slug = await this.generateUniqueSlug(orgData.name);

    const result = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { ...orgData, slug, status: 'active' as any },
      });

      let adminUser: { id: string; name: string; email: string | null; is_active: boolean; created_at: Date };
      let adminWasCreated = false;

      if (existing_user_id) {
        // Path A: pick an existing user directly by ID
        const found = await tx.user.findUnique({
          where: { id: existing_user_id },
          select: { id: true, name: true, email: true, country_code: true, phone: true, is_active: true, created_at: true },
        });
        if (!found) throw new NotFoundException(`User ${existing_user_id} not found`);
        // Issue #5: a typed phone can't be applied to an already-existing account here.
        if (admin_phone && (found.country_code !== admin_country_code || found.phone !== admin_phone)) {
          throw new BadRequestException(
            `${found.name} already has a V2E login, so the phone number you entered was NOT applied. ` +
              `Create the firm without it, then set their number from the member's Edit screen.`,
          );
        }
        adminUser = found;
      } else {
        // Path B: find or create by email OR phone-pair (either identifies the login)
        const [byEmail, byPhone] = await Promise.all([
          admin_email ? tx.user.findUnique({ where: { email: admin_email } }) : Promise.resolve(null),
          admin_phone
            ? tx.user.findUnique({ where: { country_code_phone: { country_code: admin_country_code!, phone: admin_phone } } })
            : Promise.resolve(null),
        ]);
        if (byEmail && byPhone && byEmail.id !== byPhone.id) {
          throw new BadRequestException('That email and phone number belong to two different people.');
        }
        const found = byEmail ?? byPhone;
        if (found) {
          // Issue #5: if a phone was typed but it isn't already this person's number
          // (e.g. they were matched by email), it would be silently dropped. Stop and
          // tell the admin plainly instead of pretending it was saved.
          if (admin_phone && (found.country_code !== admin_country_code || found.phone !== admin_phone)) {
            throw new BadRequestException(
              `${found.name} already has a V2E login, so the phone number you entered was NOT applied. ` +
                `Create the firm without it, then set their number from the member's Edit screen.`,
            );
          }
          adminUser = found;
        } else {
          if (!admin_password) {
            throw new BadRequestException('A password is required for a brand-new admin login.');
          }
          const password_hash = await bcrypt.hash(admin_password, 12);
          adminUser = await tx.user.create({
            data: { name: admin_name!, email: admin_email, country_code: admin_country_code, phone: admin_phone, password_hash, is_active: true },
            select: { id: true, name: true, email: true, is_active: true, created_at: true },
          });
          adminWasCreated = true;
        }
      }

      // An org admin must always have an email — covers picking/matching an existing
      // phone-only person as the firm's administrator.
      if (!adminUser.email) {
        throw new BadRequestException('An organization admin must have an email address, so their team can recover access.');
      }

      const member = await tx.organizationMember.create({
        // The provisioning admin is the org's first platform administrator.
        data: { organization_id: organization.id, user_id: adminUser.id, is_admin: true, is_active: true },
      });

      // Seed each module to its per-key default (most `full`; opt-out modules like
      // Delegation seed `off` and stay dark until the vendor hands them over).
      await tx.orgModuleEntitlement.createMany({
        data: ENTITLEMENT_MODULE_KEYS.map((module_key) => ({
          organization_id: organization.id,
          module_key,
          state: (ENTITLEMENT_DEFAULT_BY_KEY[module_key] ?? 'full') as EntitlementState,
        })),
        skipDuplicates: true,
      });

      // Seed the locked Administrator (System) role — full access, non-editable.
      // Custom roles are created later in the Access Control UI.
      await tx.systemRole.create({
        data: {
          organization_id: organization.id,
          name: 'Administrator',
          description:
            'Full access to everything. This is a system role — it cannot be edited or deleted.',
          is_system: true,
          is_admin: true,
          default_scope: DataScope.org,
        },
      });

      // Seed the editable default roles (Employee / Manager / Leadership),
      // differentiated by data scope. Idempotent and additive; Administrator
      // above stays the locked role.
      await seedDefaultSystemRoles(tx, organization.id);

      // Seed Task Masters (config + default priorities/statuses) so the Create
      // Task form has a populated Status dropdown from the very first task.
      await seedTaskMasters(tx, organization.id);

      return {
        organization,
        adminWasCreated,
        admin: {
          id: adminUser.id,
          name: adminUser.name,
          email: adminUser.email,
          is_admin: member.is_admin,
          organization_id: organization.id,
          is_active: adminUser.is_active,
          created_at: adminUser.created_at,
        },
      };
    });

    // Welcome the new admin — best-effort, never fail provisioning on a mail error.
    // A freshly-created admin gets their credentials; an existing user who was
    // made admin of this new firm gets a "you've been added" notice instead.
    try {
      // A phone-only admin has no email address — nothing to send to, so skip the mail.
      if (result.admin.email) {
        if (result.adminWasCreated && admin_password) {
          await this.mail.sendWelcomeCredentials({
            to: result.admin.email,
            name: result.admin.name,
            firmName: result.organization.name,
            password: admin_password,
          });
        } else {
          await this.mail.sendAddedToFirm({
            to: result.admin.email,
            name: result.admin.name,
            firmName: result.organization.name,
          });
        }
      }
    } catch (err) {
      // MailService already logs; swallow so the org+admin still succeed.
    }

    const { adminWasCreated: _omit, ...response } = result;
    return response;
  }

  async update(id: string, dto: UpdateOrganizationDto) {
    await this.findOne(id);

    return this.prisma.organization.update({
      where: { id },
      data: dto as any,
    });
  }

  /**
   * Firm-wide kill switch. Only the org's status flips — memberships, users and
   * passwords stay intact, so reactivating restores everyone as they were. The
   * lockout itself is enforced in auth (see `common/org-status.util.ts`).
   */
  async deactivate(id: string) {
    await this.findOne(id);

    return this.prisma.organization.update({
      where: { id },
      data: { status: 'inactive' },
    });
  }

  /** Undo a deactivation — the firm's users can sign in again immediately. */
  async reactivate(id: string) {
    await this.findOne(id);

    return this.prisma.organization.update({
      where: { id },
      data: { status: 'active' },
    });
  }
}
