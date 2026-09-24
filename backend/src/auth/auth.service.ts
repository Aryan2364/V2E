import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SwitchOrgDto } from './dto/switch-org.dto';
import { classifyIdentifier } from '../common/identifier.util';
import { ORG_DEACTIVATED_MESSAGE, isOrganizationDeactivated } from '../common/org-status.util';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already registered');

    const password_hash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: { name: dto.name, email: dto.email, password_hash },
    });

    // Registration only ever mints a personal account. Attaching a user to an
    // organization — and any admin grant — is a privileged action that must go
    // through an authenticated, org-scoped route (POST /org/:orgId/users), never
    // a public body field. See SECURITY_AUDIT.md C1.
    return this.issueFullTokens(user.id, user.email, null, false);
  }

  // Resolve a login identity typed as either an email or a phone number. A phone
  // is matched on the (country_code, phone) PAIR — never on digits alone — so the
  // same national number under +91 and +971 stays two different accounts.
  private async findUserByIdentifier(identifier: string, countryCode?: string) {
    const classified = classifyIdentifier(identifier, countryCode);
    let user = null as Awaited<ReturnType<typeof this.prisma.user.findUnique>>;
    if (classified.value) {
      user =
        classified.kind === 'email'
          ? await this.prisma.user.findUnique({ where: { email: classified.value } })
          : await this.prisma.user.findUnique({
              where: {
                country_code_phone: {
                  country_code: classified.countryCode,
                  phone: classified.value,
                },
              },
            });
    }
    return { user, kind: classified.kind };
  }

  private identifierNotFoundMessage(kind: 'email' | 'phone'): string {
    return kind === 'phone'
      ? 'Mobile number not found. Please try another number, or your email address.'
      : 'Email address not found. Please try another email, or your phone number if registered.';
  }

  async login(dto: LoginDto) {
    const { user, kind } = await this.findUserByIdentifier(dto.identifier, dto.country_code);
    if (!user || !user.is_active) throw new UnauthorizedException(this.identifierNotFoundMessage(kind));

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('Incorrect password. Please try again.');

    const allMemberships = await this.prisma.organizationMember.findMany({
      where: { user_id: user.id, is_active: true },
      include: {
        organization: { select: { id: true, name: true, slug: true, logo_url: true, status: true } },
      },
      orderBy: { joined_at: 'asc' },
    });

    // A deactivated firm keeps its memberships intact, so the membership row alone
    // can't say whether this person may sign in — the org's status decides. Super
    // admins are exempt so support can still get in. See org-status.util.ts.
    const memberships = user.is_super_admin
      ? allMemberships
      : allMemberships.filter((m) => !isOrganizationDeactivated(m.organization.status));

    if (memberships.length === 0) {
      throw new UnauthorizedException(
        allMemberships.length > 0 ? ORG_DEACTIVATED_MESSAGE : 'No active organization membership',
      );
    }

    if (memberships.length === 1) {
      const m = memberships[0];
      const tokens = await this.issueFullTokens(user.id, user.email, m.organization_id, false);
      return { ...tokens, user: await this.buildUserPayload(user, m.organization_id, m.is_admin, false) };
    }

    const selectionToken = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'org_selection' },
      { secret: this.configService.get<string>('JWT_SECRET')!, expiresIn: '10m' },
    );

    return {
      requires_org_selection: true,
      selection_token: selectionToken,
      user: { id: user.id, name: user.name, email: user.email },
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        logo_url: m.organization.logo_url,
        is_admin: m.is_admin,
        joined_at: m.joined_at,
      })),
    };
  }

  async switchOrg(userId: string, dto: SwitchOrgDto) {
    const member = await this.prisma.organizationMember.findFirst({
      where: { user_id: userId, organization_id: dto.organizationId, is_active: true },
      include: { organization: { select: { status: true } } },
    });
    if (!member) throw new ForbiddenException('Not a member of this organization');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.is_active) throw new UnauthorizedException();

    if (!user.is_super_admin && isOrganizationDeactivated(member.organization.status)) {
      throw new ForbiddenException(ORG_DEACTIVATED_MESSAGE);
    }

    const tokens = await this.issueFullTokens(user.id, user.email, dto.organizationId, false);
    return { ...tokens, user: await this.buildUserPayload(user, dto.organizationId, member.is_admin, false) };
  }

  async getMyOrgs(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { is_super_admin: true },
    });
    return this.prisma.organizationMember.findMany({
      where: {
        user_id: userId,
        is_active: true,
        // Never offer a deactivated firm as somewhere to switch into.
        ...(user?.is_super_admin ? {} : { organization: { status: { not: 'inactive' } } }),
      },
      include: {
        organization: { select: { id: true, name: true, slug: true, logo_url: true, industry: true } },
      },
      orderBy: { joined_at: 'asc' },
    });
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });

      // Tokens are stored hashed. Accept the current hash, OR the immediately-
      // previous hash while it's still inside its grace window — this lets a
      // concurrent/racing refresh (multiple tabs waking together) succeed with a
      // token that was rotated a moment ago, instead of being force-logged-out.
      const incomingHash = this.hashToken(refreshToken);
      const matchesCurrent = !!user?.refresh_token && user.refresh_token === incomingHash;
      const matchesPrev =
        !!user?.refresh_token_prev &&
        user.refresh_token_prev === incomingHash &&
        !!user.refresh_token_prev_exp &&
        user.refresh_token_prev_exp.getTime() > Date.now();

      if (!user || !user.is_active || (!matchesCurrent && !matchesPrev)) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      const organizationId = payload.organizationId ?? null;
      let isAdmin = false;
      if (organizationId) {
        const member = await this.prisma.organizationMember.findFirst({
          where: { user_id: user.id, organization_id: organizationId, is_active: true },
          select: { is_admin: true, organization: { select: { status: true } } },
        });
        // Deactivating a firm must end sessions that are already open, not just
        // block new logins — so a refresh for a dead org is refused.
        if (!user.is_super_admin && isOrganizationDeactivated(member?.organization?.status)) {
          throw new UnauthorizedException(ORG_DEACTIVATED_MESSAGE);
        }
        isAdmin = member?.is_admin ?? false;
      }
      // Rotate, demoting the just-used current hash into the grace slot.
      const tokens = await this.issueFullTokens(user.id, user.email, organizationId, user.is_super_admin, {
        demotePrevHash: user.refresh_token,
      });
      return {
        ...tokens,
        user: await this.buildUserPayload(user, organizationId, isAdmin, user.is_super_admin),
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async adminLogin(dto: LoginDto) {
    const { user, kind } = await this.findUserByIdentifier(dto.identifier, dto.country_code);
    if (!user || !user.is_active) throw new UnauthorizedException(this.identifierNotFoundMessage(kind));

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('Incorrect password. Please try again.');

    if (!user.is_super_admin) throw new UnauthorizedException('Access denied. Super administrator credentials required.');

    const tokens = await this.issueFullTokens(user.id, user.email, null, true);
    return { ...tokens, user: await this.buildUserPayload(user, null, false, true) };
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refresh_token: null, refresh_token_prev: null, refresh_token_prev_exp: null },
    });
    return { message: 'Logged out successfully' };
  }

  /**
   * Self-service password change for an already-authenticated user. By product
   * decision this requires neither the current password nor an email OTP — the
   * live session is treated as sufficient proof. The current session's refresh
   * tokens are left intact so the user stays logged in after changing it.
   */
  async changePassword(userId: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Account not found.');
    const password_hash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password_hash },
    });
    return { success: true };
  }

  async listAdmins() {
    const admins = await this.prisma.user.findMany({
      where: { is_super_admin: true },
      select: { id: true, name: true, email: true, is_active: true, created_at: true },
      orderBy: { created_at: 'asc' },
    });
    return admins;
  }

  async createAdmin(dto: { name: string; email: string; password: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      if (existing.is_super_admin) throw new ConflictException('This email is already a super administrator.');
      // Promote existing user to super admin
      return this.prisma.user.update({
        where: { id: existing.id },
        data: { is_super_admin: true },
        select: { id: true, name: true, email: true, is_active: true, created_at: true },
      });
    }
    const password_hash = await bcrypt.hash(dto.password, 12);
    return this.prisma.user.create({
      data: { name: dto.name, email: dto.email, password_hash, is_super_admin: true },
      select: { id: true, name: true, email: true, is_active: true, created_at: true },
    });
  }

  async toggleAdmin(targetId: string, requesterId: string, is_active: boolean) {
    if (targetId === requesterId) throw new ForbiddenException('You cannot deactivate your own account.');
    return this.prisma.user.update({
      where: { id: targetId, is_super_admin: true },
      data: { is_active },
      select: { id: true, name: true, email: true, is_active: true, created_at: true },
    });
  }

  async revokeAdmin(targetId: string, requesterId: string) {
    if (targetId === requesterId) {
      throw new ForbiddenException('You cannot revoke your own super admin access.');
    }
    const adminCount = await this.prisma.user.count({
      where: { is_super_admin: true },
    });
    if (adminCount <= 1) {
      throw new ForbiddenException('At least one super administrator account is required at all times.');
    }
    return this.prisma.user.update({
      where: { id: targetId, is_super_admin: true },
      data: { is_super_admin: false },
      select: { id: true, name: true, email: true, is_active: true, created_at: true },
    });
  }

  async updateAdmin(id: string, dto: { name?: string; email: string; password?: string }) {
    if (!dto.email?.trim() || !dto.password) {
      throw new BadRequestException('Email address and password are required to save changes.');
    }

    const admin = await this.prisma.user.findFirst({ where: { id, is_super_admin: true } });
    if (!admin) throw new NotFoundException('Admin user not found.');

    if (dto.email.trim() !== admin.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email.trim() } });
      if (existing) throw new ConflictException('This email is already taken.');
    }

    const password_hash = await bcrypt.hash(dto.password, 12);

    return this.prisma.user.update({
      where: { id },
      data: {
        email: dto.email.trim(),
        password_hash,
        ...(dto.name !== undefined && { name: dto.name.trim() }),
      },
      select: { id: true, name: true, email: true, is_active: true, created_at: true },
    });
  }

  /** sha256 hex — refresh tokens are high-entropy JWTs, so a fast hash is sufficient. */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // Grace window (ms) during which the immediately-previous refresh token still
  // works after rotation — long enough to absorb a multi-tab wake-up race, short
  // enough that a leaked old token isn't usable for meaningfully long.
  private static readonly REFRESH_GRACE_MS = 60_000;

  private async issueFullTokens(
    userId: string,
    email: string | null, // a phone-only account has no email
    organizationId: string | null,
    isSuperAdmin: boolean,
    opts?: { demotePrevHash?: string | null },
  ) {
    const payload: Record<string, any> = { sub: userId, email, isSuperAdmin };
    if (organizationId) payload.organizationId = organizationId;

    const access_token = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET')!,
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') as any,
    });

    const refresh_token = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') as any,
    });

    // Store only the hash. On a rotation (refresh) we keep the just-used hash in
    // the grace slot; a fresh login clears the grace slot outright.
    const data: Record<string, any> = { refresh_token: this.hashToken(refresh_token) };
    if (opts?.demotePrevHash) {
      data.refresh_token_prev = opts.demotePrevHash;
      data.refresh_token_prev_exp = new Date(Date.now() + AuthService.REFRESH_GRACE_MS);
    } else {
      data.refresh_token_prev = null;
      data.refresh_token_prev_exp = null;
    }

    await this.prisma.user.update({ where: { id: userId }, data });

    return { access_token, refresh_token };
  }

  private async buildUserPayload(
    user: { id: string; name: string; email: string | null; country_code?: string | null; phone?: string | null },
    organizationId: string | null,
    isAdmin: boolean,
    isSuperAdmin: boolean,
  ) {
    let isTestOrg = false;
    let effectiveIsAdmin = isAdmin;
    if (organizationId) {
      const [org, profile] = await Promise.all([
        this.prisma.organization.findUnique({
          where: { id: organizationId },
          select: { is_test: true },
        }),
        this.prisma.employeeProfile.findFirst({
          where: { user_id: user.id, organization_id: organizationId },
          select: { system_role: { select: { is_admin: true } } },
        }),
      ]);
      isTestOrg = org?.is_test ?? false;
      // Mirror JwtStrategy: admin = the membership's admin flag OR the System Role's
      // is_admin. A user made Administrator via System Role (not org-owner) must get
      // the admin shell, so the frontend doesn't render them as a plain member.
      effectiveIsAdmin = isAdmin || (profile?.system_role?.is_admin ?? false);
    }
    return { id: user.id, name: user.name, email: user.email, country_code: user.country_code ?? null, phone: user.phone ?? null, isSuperAdmin, organizationId, is_admin: effectiveIsAdmin, isTestOrg };
  }
}
