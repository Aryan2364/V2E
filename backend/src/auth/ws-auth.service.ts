import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { isOrganizationDeactivated } from '../common/org-status.util';

export interface WsPrincipal {
  userId: string;
  organizationId: string | null;
}

/**
 * Handshake authentication for WebSocket gateways.
 *
 * The HTTP side proves identity with `JwtAuthGuard` (`jwt.strategy.ts`); sockets
 * have no equivalent, so this is their gate. It verifies the SAME access-token
 * JWT the HTTP client already carries, then resolves the trusted principal
 * (userId + active org) SOLELY from the verified token. Handshake fields the
 * client can set freely (`auth.userId`, `auth.orgId`) are never trusted — that
 * was the exact hole in SECURITY_AUDIT C4/C5, where the gateways joined
 * `user:{client-supplied-id}` rooms with no verification at all.
 *
 * Returns `null` on ANY failure (missing / malformed / expired / tampered token,
 * org-selection token, unknown or deactivated user). The caller must refuse the
 * connection. Fails closed.
 */
@Injectable()
export class WsAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Pull the bearer token out of the handshake. Primary source is the Socket.IO
   * `auth` payload (`{ auth: { token } }`), which travels over both the websocket
   * and polling transports; the `Authorization` header is a fallback for polling.
   */
  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake?.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth.trim()) {
      return fromAuth.replace(/^Bearer\s+/i, '').trim();
    }
    const header = client.handshake?.headers?.authorization;
    if (typeof header === 'string' && header.trim()) {
      return header.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
  }

  async authenticate(client: Socket): Promise<WsPrincipal | null> {
    const token = this.extractToken(client);
    if (!token) return null;

    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>('JWT_SECRET')!,
      });
    } catch {
      // Bad signature, expired, or malformed — reject.
      return null;
    }

    if (!payload || typeof payload.sub !== 'string') return null;
    // Org-selection tokens are pre-org, not full session tokens — never a socket credential.
    if (payload.type === 'org_selection') return null;

    // Mirror jwt.strategy.ts: the token alone isn't enough — the user must still
    // exist and be active (covers deactivation after the token was minted).
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.is_active) return null;

    const organizationId =
      typeof payload.organizationId === 'string' ? payload.organizationId : null;

    // Same kill switch as jwt.strategy.ts: a firm deactivated from the super-admin
    // portal must lose its live sockets too, not keep receiving realtime events.
    if (organizationId && !user.is_super_admin) {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { status: true },
      });
      if (isOrganizationDeactivated(org?.status)) return null;
    }

    return { userId: user.id, organizationId };
  }
}
