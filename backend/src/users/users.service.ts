import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePhoneForSave } from '../common/identifier.util';
import { UpdateUserDto } from './dto/update-user.dto';

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  country_code: true,
  phone: true,
  is_active: true,
  created_at: true,
  updated_at: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(orgId: string) {
    const members = await this.prisma.organizationMember.findMany({
      where: { organization_id: orgId, is_active: true },
      include: { user: { select: USER_SELECT } },
      orderBy: { joined_at: 'desc' },
    });
    return members.map((m) => this.toUserDto(m, orgId));
  }

  // Returns members in the format the task assignee picker expects — open to all roles
  async findMembers(orgId: string) {
    const members = await this.prisma.organizationMember.findMany({
      where: { organization_id: orgId, is_active: true },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joined_at: 'asc' },
    });
    return members.map((m) => ({
      id: m.id,
      user_id: m.user_id,
      is_admin: m.is_admin,
      user: { id: m.user.id, name: m.user.name, email: m.user.email },
    }));
  }

  async findOne(id: string, orgId: string) {
    const member = await this.prisma.organizationMember.findFirst({
      where: { user_id: id, organization_id: orgId },
      include: { user: { select: USER_SELECT } },
    });
    if (!member) throw new NotFoundException('User not found in this organization');
    return this.toUserDto(member, orgId);
  }

  async update(id: string, orgId: string, dto: UpdateUserDto) {
    const before = await this.findOne(id, orgId);

    // Pull the login-identity fields out so email/phone never get written raw — they
    // must go through the checks below (a person must keep at least one handle, and
    // an admin must keep an email).
    const { password, is_admin, email, phone, country_code, ...rest } = dto;
    const userUpdateData: Record<string, unknown> = { ...rest };
    if (password) {
      userUpdateData.password_hash = await bcrypt.hash(password, 12);
    }

    // What the email will be after this save (blank/whitespace clears it to null).
    let resultingEmail: string | null = before.email ?? null;
    if (email !== undefined) {
      resultingEmail = email.trim() || null;
      userUpdateData.email = resultingEmail;
    }

    // What the phone will be after this save. The phone is normalised + validated +
    // collision-checked via the SAME shared helper as create + login (no second copy).
    let resultingPhone: string | null = before.phone ?? null;
    if (phone !== undefined || country_code !== undefined) {
      const resolved = resolvePhoneForSave(country_code, phone);
      if (resolved.phone) {
        // Reject if this exact (country_code, phone) already belongs to someone else.
        const clash = await this.prisma.user.findUnique({
          where: { country_code_phone: { country_code: resolved.country_code!, phone: resolved.phone } },
          select: { id: true },
        });
        if (clash && clash.id !== id) {
          throw new ConflictException('This number is already used by another account.');
        }
      }
      userUpdateData.country_code = resolved.country_code; // string or null (cleared)
      userUpdateData.phone = resolved.phone; // string or null (cleared)
      resultingPhone = resolved.phone;
    }

    // Rule: every person must keep at least one login handle (email OR phone).
    if (!resultingEmail && !resultingPhone) {
      throw new BadRequestException('This person needs at least an email or a phone number to sign in.');
    }

    // Rule: an admin must always keep an email (their team can recover access). This
    // covers BOTH blanking an existing admin's email AND promoting a handle-only
    // person to admin. "Admin after this save" = admin here (per is_admin, or the
    // current flag if unchanged) OR already an admin in any OTHER org.
    const adminHereAfter = is_admin === undefined ? before.is_admin : is_admin;
    const adminElsewhere = !!(await this.prisma.organizationMember.findFirst({
      where: { user_id: id, is_admin: true, is_active: true, organization_id: { not: orgId } },
      select: { id: true },
    }));
    if ((adminHereAfter || adminElsewhere) && !resultingEmail) {
      throw new BadRequestException('An admin must always have an email address, so their team can recover access.');
    }

    await this.prisma.user.update({ where: { id }, data: userUpdateData });

    if (is_admin !== undefined) {
      await this.prisma.organizationMember.updateMany({
        where: { user_id: id, organization_id: orgId },
        data: { is_admin },
      });
    }

    return this.findOne(id, orgId);
  }

  async deactivate(id: string, orgId: string) {
    const member = await this.prisma.organizationMember.findFirst({
      where: { user_id: id, organization_id: orgId },
    });
    if (!member) throw new NotFoundException(`User not found in this organization`);

    // Prevent deactivating the primary administrator of the organization
    const primaryAdmin = await this.prisma.organizationMember.findFirst({
      where: { organization_id: orgId, is_admin: true },
      orderBy: { joined_at: 'asc' },
    });
    if (primaryAdmin && id === primaryAdmin.user_id) {
      throw new BadRequestException(
        'The primary administrator of this organization cannot be deactivated.',
      );
    }

    await this.prisma.organizationMember.update({
      where: { id: member.id },
      data: { is_active: false },
    });

    return this.findOne(id, orgId);
  }

  private toUserDto(member: any, orgId: string) {
    return {
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      country_code: member.user.country_code,
      phone: member.user.phone,
      is_admin: member.is_admin,
      is_active: member.is_active && member.user.is_active,
      organization_id: orgId,
      created_at: member.user.created_at,
      updated_at: member.user.updated_at,
    };
  }
}
