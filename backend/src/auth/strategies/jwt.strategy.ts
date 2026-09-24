import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ORG_DEACTIVATED_MESSAGE, isOrganizationDeactivated } from '../../common/org-status.util';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.is_active) throw new UnauthorizedException();

    const organizationId = payload.organizationId ?? null;

    // A user can now have one profile PER organization — resolve, for the org this
    // token is scoped to: the org's test flag, the employee profile (+ its System
    // Role), and the membership's admin flag. System Role + is_admin drive the
    // four-layer model; admin = platform-admin flag OR the System Role's is_admin.
    let isTestOrg = false;
    let employeeProfileId: string | null = null;
    let systemRoleId: string | null = null;
    let isAdmin = false;
    if (organizationId) {
      const [org, profile, member] = await Promise.all([
        this.prisma.organization.findUnique({
          where: { id: organizationId },
          select: { is_test: true, status: true },
        }),
        this.prisma.employeeProfile.findFirst({
          where: { user_id: user.id, organization_id: organizationId },
          select: { id: true, system_role_id: true, system_role: { select: { is_admin: true } } },
        }),
        this.prisma.organizationMember.findUnique({
          where: { organization_id_user_id: { organization_id: organizationId, user_id: user.id } },
          select: { is_admin: true },
        }),
      ]);
      // A firm deactivated from the super-admin portal loses access immediately —
      // an access token minted before the switch was thrown must stop working, not
      // keep the session alive until it expires. Super admins are exempt so they
      // can still open the firm to inspect or reactivate it.
      if (!user.is_super_admin && isOrganizationDeactivated(org?.status)) {
        throw new UnauthorizedException(ORG_DEACTIVATED_MESSAGE);
      }

      isTestOrg = org?.is_test ?? false;
      employeeProfileId = profile?.id ?? null;
      systemRoleId = profile?.system_role_id ?? null;
      isAdmin = (member?.is_admin ?? false) || (profile?.system_role?.is_admin ?? false);
    }

    return {
      id: user.id,
      email: user.email,
      country_code: user.country_code,
      phone: user.phone,
      name: user.name,
      isSuperAdmin: user.is_super_admin,
      organizationId,
      is_admin: isAdmin,
      system_role_id: systemRoleId,
      isTestOrg,
      employee_profile_id: employeeProfileId,
    };
  }
}
