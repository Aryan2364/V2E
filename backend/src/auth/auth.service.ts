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

  async register(dto: RegisterDto, userAgent?: string) {
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
    return this.issueFullTokens(user.id, user.email, null, false, { userAgent });
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

  async login(dto: LoginDto, userAgent?: string) {
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
      const tokens = await this.issueFullTokens(user.id, user.email, m.organization_id, false, { userAgent });
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

  async switchOrg(userId: string, dto: SwitchOrgDto, sid?: string | null, userAgent?: string) {
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

    // Picking an org right after login (selection token, no sid) is the first time
    // this device gets real tokens, so it opens a session. A genuine org switch
    // carries the caller's sid and re-keys THAT session instead of adding a row.
    const tokens = await this.issueFullTokens(user.id, user.email, dto.organizationId, false, {
      reuseSid: sid ?? undefined,
      userAgent,
    });
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

  async refresh(refreshToken: string, userAgent?: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.is_active) throw new UnauthorizedException('Invalid refresh token');

      const incomingHash = this.hashToken(refreshToken);
      let sid: string | null = null;

      if (payload.sid) {
        sid = await this.checkSession(payload.sid, user.id, incomingHash);
      } else {
        // Legacy token (issued before per-device sessions): validate against the
        // old single-slot columns exactly as before — current hash, or the previous
        // one inside its 60s grace window. The columns are left untouched; success
        // below opens a real session so this device is on the new path from now on.
        const matchesCurrent = !!user.refresh_token && user.refresh_token === incomingHash;
        const matchesPrev =
          !!user.refresh_token_prev &&
          user.refresh_token_prev === incomingHash &&
          !!user.refresh_token_prev_exp &&
          user.refresh_token_prev_exp.getTime() > Date.now();
        if (!matchesCurrent && !matchesPrev) throw new UnauthorizedException('Invalid refresh token');
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

      const tokens = sid
        ? await this.rotateSession(sid, incomingHash, user.id, user.email, organizationId, user.is_super_admin)
        : await this.issueFullTokens(user.id, user.email, organizationId, user.is_super_admin, { userAgent });
      return {
        ...tokens,
        user: await this.buildUserPayload(user, organizationId, isAdmin, user.is_super_admin),
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Validate an incoming refresh token against its session row. Returns the sid.
   *  - matches the current hash            -> fine.
   *  - matches the previous hash, and the client never confirmed the current one
   *    -> fine: the reply carrying the current token was lost, so the old token
   *    stays valid until the client actually uses a newer one.
   *  - matches the previous hash after the current one WAS confirmed -> a
   *    superseded token is being replayed: treat as theft and revoke the session.
   *  - matches neither (an older generation) -> same: revoke.
   */
  private async checkSession(sid: string, userId: string, incomingHash: string): Promise<string> {
    const session = await this.prisma.userSession.findUnique({ where: { id: sid } });
    if (!session || session.user_id !== userId || session.expires_at.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (session.token_hash === incomingHash) return sid;
    if (session.prev_token_hash === incomingHash && !session.current_confirmed) return sid;
    await this.prisma.userSession.deleteMany({ where: { id: sid } });
    throw new UnauthorizedException('Invalid refresh token');
  }

  /**
   * Rotate a session's refresh token in place. Race-safe: the write is a
   * compare-and-swap (`updateMany` conditional on the hashes we read), so two
   * concurrent refreshes of one session can never both rotate from the same state.
   * The loser (count 0) re-reads and, if its token is still acceptable (it is now
   * the winner's "previous" token), retries ONCE from the new state, chaining
   * prev = the winner's token so BOTH callers' tokens stay usable. A second loss
   * is a 401 - the frontend's single-flight lock (lib/api/refresh.ts) means one
   * client never races itself, so that is only reachable by abuse.
   */
  private async rotateSession(
    sid: string,
    incomingHash: string,
    userId: string,
    email: string | null,
    organizationId: string | null,
    isSuperAdmin: boolean,
  ) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await this.prisma.userSession.findUnique({ where: { id: sid } });
      if (!session || session.user_id !== userId) break;
      const matchedCurrent = session.token_hash === incomingHash;
      if (!matchedCurrent && !(session.prev_token_hash === incomingHash && !session.current_confirmed)) break;

      const tokens = this.signTokens(userId, email, organizationId, isSuperAdmin, sid);
      const res = await this.prisma.userSession.updateMany({
        where: { id: sid, token_hash: session.token_hash, prev_token_hash: session.prev_token_hash },
        data: {
          token_hash: this.hashToken(tokens.refresh_token),
          // Presenting the current token proves receipt, so it becomes the fallback.
          // A retry of the previous token (lost reply) keeps that token as the
          // fallback until the client proves it has a newer one - except on a lost
          // race, where the winner's current token is the one that must survive.
          prev_token_hash: matchedCurrent || attempt > 0 ? session.token_hash : session.prev_token_hash,
          current_confirmed: false,
          last_used_at: new Date(),
          expires_at: this.refreshExpiry(tokens.refresh_token),
        },
      });
      if (res.count === 1) return tokens;
    }
    throw new UnauthorizedException('Invalid refresh token');
  }

  async adminLogin(dto: LoginDto, userAgent?: string) {
    const { user, kind } = await this.findUserByIdentifier(dto.identifier, dto.country_code);
    if (!user || !user.is_active) throw new UnauthorizedException(this.identifierNotFoundMessage(kind));

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('Incorrect password. Please try again.');

    if (!user.is_super_admin) throw new UnauthorizedException('Access denied. Super administrator credentials required.');

    const tokens = await this.issueFullTokens(user.id, user.email, null, true, { userAgent });
    return { ...tokens, user: await this.buildUserPayload(user, null, false, true) };
  }

  /** Ends THIS device's session only. A legacy token (no sid) clears the old single slot. */
  async logout(userId: string, sid?: string | null) {
    if (sid) {
      await this.prisma.userSession.deleteMany({ where: { id: sid, user_id: userId } });
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: { refresh_token: null, refresh_token_prev: null, refresh_token_prev_exp: null },
      });
    }
    return { message: 'Logged out successfully' };
  }

  /** Ends every device's session, including any pre-sessions (legacy) token. */
  async logoutAll(userId: string) {
    await this.revokeAllSessions(userId);
    return { message: 'Logged out of all devices' };
  }

  /** Delete all of a user's sessions (optionally sparing one) and clear the legacy slot. */
  async revokeAllSessions(userId: string, exceptSid?: string | null) {
    await this.prisma.userSession.deleteMany({
      where: { user_id: userId, ...(exceptSid ? { id: { not: exceptSid } } : {}) },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { refresh_token: null, refresh_token_prev: null, refresh_token_prev_exp: null },
    });
  }

  /**
   * Self-service password change for an already-authenticated user. By product
   * decision this requires neither the current password nor an email OTP — the
   * live session is treated as sufficient proof. Every OTHER device is signed out
   * (a changed password should boot anyone else holding a session); the current
   * session is kept so the user stays logged in after changing it.
   */
  async changePassword(userId: string, newPassword: string, sid?: string | null) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Account not found.');
    const password_hash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password_hash },
    });
    // A caller without a sid is on a legacy token, whose slot we must not clear.
    if (sid) await this.revokeAllSessions(userId, sid);
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

  // Grace window (ms) during which the immediately-previous LEGACY refresh token
  // (pre-sessions, no sid) still works after rotation. Per-device sessions use no
  // timer: the previous token stays valid until the client confirms the new one.
  private static readonly REFRESH_GRACE_MS = 60_000;
  private static readonly USER_AGENT_MAX = 255;
  private static readonly DEFAULT_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  /** Sign an access + refresh pair bound to a session via the `sid` claim. */
  private signTokens(
    userId: string,
    email: string | null, // a phone-only account has no email
    organizationId: string | null,
    isSuperAdmin: boolean,
    sid: string,
  ) {
    const payload: Record<string, any> = { sub: userId, email, isSuperAdmin, sid };
    if (organizationId) payload.organizationId = organizationId;

    const access_token = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET')!,
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') as any,
    });

    // `jti` keeps two refresh tokens minted in the same second distinct (iat has
    // second resolution), otherwise a rotation could reproduce the same hash.
    const refresh_token = this.jwtService.sign(
      { ...payload, jti: crypto.randomUUID() },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') as any,
      },
    );

    return { access_token, refresh_token };
  }

  /** The session's sliding expiry = the refresh token's own `exp`. */
  private refreshExpiry(refreshToken: string): Date {
    const decoded: any = this.jwtService.decode?.(refreshToken);
    return decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + AuthService.DEFAULT_REFRESH_TTL_MS);
  }

  /**
   * Issue tokens for a sign-in. By default opens a NEW session (one per device);
   * with `reuseSid` (org switch) the caller's existing session is re-keyed instead.
   * Only the token hash is stored.
   */
  private async issueFullTokens(
    userId: string,
    email: string | null,
    organizationId: string | null,
    isSuperAdmin: boolean,
    opts?: { reuseSid?: string; userAgent?: string },
  ) {
    const user_agent = opts?.userAgent ? opts.userAgent.slice(0, AuthService.USER_AGENT_MAX) : null;

    if (opts?.reuseSid) {
      const tokens = this.signTokens(userId, email, organizationId, isSuperAdmin, opts.reuseSid);
      // The old refresh token carried the previous org; the client replaces it, so
      // no fallback hash is kept.
      const res = await this.prisma.userSession.updateMany({
        where: { id: opts.reuseSid, user_id: userId },
        data: {
          token_hash: this.hashToken(tokens.refresh_token),
          prev_token_hash: null,
          current_confirmed: false,
          last_used_at: new Date(),
          expires_at: this.refreshExpiry(tokens.refresh_token),
        },
      });
      if (res.count === 1) return tokens;
      // The session was revoked meanwhile - fall through and open a fresh one.
    }

    // Housekeeping: drop this user's expired sessions whenever a new one opens.
    await this.prisma.userSession.deleteMany({
      where: { user_id: userId, expires_at: { lte: new Date() } },
    });

    const sid = crypto.randomUUID();
    const tokens = this.signTokens(userId, email, organizationId, isSuperAdmin, sid);
    await this.prisma.userSession.create({
      data: {
        id: sid,
        user_id: userId,
        token_hash: this.hashToken(tokens.refresh_token),
        user_agent,
        expires_at: this.refreshExpiry(tokens.refresh_token),
      },
    });
    return tokens;
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
