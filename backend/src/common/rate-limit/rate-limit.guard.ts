import { ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';
import { classifyIdentifier } from '../identifier.util';

/**
 * Rate-limit guard, registered globally but only counting routes marked
 * @AuthRateLimit (see rate-limit.config.ts). This class only decides WHO a
 * request counts against, per throttler.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  private readonly jwt = new JwtService();

  // Sockets (chat, notifications) authenticate per connection and have no Express
  // request/response; HTTP is the only thing throttled here.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return super.canActivate(context);
  }

  protected async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const name = props.throttler.name;
    const getTracker =
      name === 'auth'
        ? (req: Record<string, any>) => this.ipAccountTracker(req)
        : (req: Record<string, any>) => this.accountTracker(req);
    return super.handleRequest({ ...props, getTracker });
  }

  private ipAccountTracker(req: Record<string, any>): string {
    const ip = `ip:${this.ip(req)}`;
    const account = this.bodyAccount(req) ?? this.verifiedUserId(req);
    return account ? `${ip}|acct:${account}` : ip;
  }

  private accountTracker(req: Record<string, any>): string {
    const account = this.bodyAccount(req) ?? this.verifiedUserId(req);
    // No account named and nobody signed in: nothing to count per account, so
    // fall back to the IP rather than pooling every anonymous caller together.
    return account ? `acct:${account}` : `ip:${this.ip(req)}`;
  }

  /**
   * The account a sign-in / reset request is about, normalised exactly the way the
   * login lookup normalises it, so "98765 43210", "09876543210" and "+91 9876543210"
   * (or Name@X.com and name@x.com) all count against ONE bucket and cannot be used
   * to multiply an attacker's attempts.
   */
  private bodyAccount(req: Record<string, any>): string | null {
    const body = req.body ?? {};
    const raw = typeof body.identifier === 'string' ? body.identifier : typeof body.email === 'string' ? body.email : null;
    if (!raw || !raw.trim()) return null;
    try {
      const c = classifyIdentifier(raw, typeof body.country_code === 'string' ? body.country_code : undefined);
      if (c.kind === 'email') return `e:${c.value.toLowerCase()}`;
      return c.value ? `p:${c.countryCode}:${c.value}` : `raw:${raw.trim().toLowerCase()}`;
    } catch {
      return `raw:${raw.trim().toLowerCase()}`;
    }
  }

  /**
   * The user id from a VALID bearer token. Verified (not just decoded): an unsigned
   * `sub` could be changed on every request to get a fresh bucket each time.
   * An expired or bad token simply means "not signed in" here; JwtAuthGuard still
   * rejects it on the route itself.
   */
  private verifiedUserId(req: Record<string, any>): string | null {
    const header = req.headers?.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    try {
      const payload: any = this.jwt.verify(header.slice(7).trim(), { secret });
      return typeof payload?.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  /**
   * The client's IP as Express resolved it under `trust proxy` (common/http/trust-proxy.ts): the real
   * address from X-Forwarded-For when a trusted proxy (Caddy, Next.js) added it,
   * otherwise the address that connected.
   */
  private ip(req: Record<string, any>): string {
    return String(req.ip ?? req.socket?.remoteAddress ?? 'unknown');
  }
}
