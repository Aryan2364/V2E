import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_SELECTION_TOKEN_KEY } from '../decorators/allow-selection-token.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /**
   * The organisation-selection token (issued after sign-in when the person belongs
   * to several firms) is signed like a real access token, so the JWT strategy
   * accepts it. It is not a session: it has no organisation, and it must only be
   * able to pick one. Without this check `GET /auth/me` answered 200 for it, the
   * app decided the person was signed in, and every organisation call then failed
   * with "Access denied", leaving a blank, org-less app after a refresh.
   * Endpoints that really are part of choosing a firm opt in with
   * @AllowSelectionToken().
   */
  handleRequest<TUser = any>(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
    status?: any,
  ): TUser {
    const authenticated = super.handleRequest<TUser>(
      err,
      user,
      info,
      context,
      status,
    );
    if (
      (authenticated as { isSelectionToken?: boolean } | null)?.isSelectionToken
    ) {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        ALLOW_SELECTION_TOKEN_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw new UnauthorizedException('Choose an organisation to continue.');
      }
    }
    return authenticated;
  }
}
