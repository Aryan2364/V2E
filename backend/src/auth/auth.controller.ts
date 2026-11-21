import { Controller, Post, Body, UseGuards, Get, Param, Patch, Delete, Put, Query, Res, Req, Headers, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CreateAdminDto, ToggleAdminDto, UpdateAdminDto } from './dto/admin.dto';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { GoogleAccountService } from '../gcal/google-account.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { SwitchOrgDto } from './dto/switch-org.dto';
import { ForgotPasswordDto, VerifyResetOtpDto, ResetPasswordDto } from './dto/forgot-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SuperAdmin } from '../common/decorators/super-admin.decorator';
import { AllowSelectionToken } from '../common/decorators/allow-selection-token.decorator';
import { clearRefreshCookie, isCookieMode, readRefreshCookie, withRefreshCookie } from './auth-cookie';
import { AuthRateLimit, HOUR, MINUTE } from '../common/rate-limit/rate-limit.decorator';
import { FailedLoginLimiter } from '../common/rate-limit/failed-login.limiter';
import { InvalidCredentialsException } from './auth.messages';

// Brute-force limits for the auth routes (the only rate-limited routes for now).
// perIp  = one machine against one account (IP + account): a typo-prone person is
//          never locked out by a colleague on the same office IP.
// perAccount = one account from anywhere (account only): cannot be dodged by
//          rotating IPs. Looser, so someone failing on purpose can only delay the
//          real owner for the window, not lock them out for good.

@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private passwordResetService: PasswordResetService,
    private googleAccounts: GoogleAccountService,
    private config: ConfigService,
    private failedLogins: FailedLoginLimiter,
  ) {}

  @AuthRateLimit({ perIp: { limit: 10, ttl: HOUR }, perAccount: { limit: 20, ttl: HOUR } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') ua?: string,
  ) {
    return withRefreshCookie(req, res, await this.authService.register(dto, ua));
  }

  // ─── Self-service password reset (public, OTP by email) ───────────────────────

  // Each call sends an email: keep it tight (the service also enforces 1 per minute).
  @AuthRateLimit({ perIp: { limit: 5, ttl: 15 * MINUTE }, perAccount: { limit: 10, ttl: HOUR } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordResetService.requestReset(dto.email);
  }

  // OTP guessing. The service allows 5 wrong codes per code; this caps how fast
  // codes can be guessed at all, including parallel requests.
  @AuthRateLimit({ perIp: { limit: 5, ttl: 15 * MINUTE }, perAccount: { limit: 10, ttl: 15 * MINUTE } })
  @Post('reset-password/verify')
  verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.passwordResetService.verifyOtp(dto.email, dto.otp);
  }

  @AuthRateLimit({ perIp: { limit: 5, ttl: 15 * MINUTE }, perAccount: { limit: 10, ttl: 15 * MINUTE } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwordResetService.resetPassword(dto.email, dto.reset_token, dto.password);
  }

  // Sign-in, org switch and refresh hand the refresh token to a client that sends
  // `X-V2E-Auth: cookie` as an httpOnly cookie instead of in the response body
  // (auth-cookie.ts). Other clients get the body as before.
  @AuthRateLimit({ perIp: { limit: 10, ttl: 15 * MINUTE }, perAccount: { limit: 30, ttl: 15 * MINUTE } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') ua?: string,
  ) {
    const result = await this.limitFailedSignIns(req, () => this.authService.login(dto, ua));
    return withRefreshCookie(req, res, result);
  }

  // The most valuable account type: strictest limits.
  @AuthRateLimit({ perIp: { limit: 5, ttl: 15 * MINUTE }, perAccount: { limit: 10, ttl: 15 * MINUTE } })
  @Post('admin-login')
  async adminLogin(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') ua?: string,
  ) {
    const result = await this.limitFailedSignIns(req, () => this.authService.adminLogin(dto, ua));
    return withRefreshCookie(req, res, result);
  }

  /**
   * Runs a sign-in under the per-IP failed sign-in limit (failed-login.limiter.ts):
   * a blocked IP is refused before any password is checked, and only a wrong email /
   * mobile number / password counts against it. Successes never count, so a whole
   * office signing in from one IP is never blocked.
   */
  private async limitFailedSignIns<T>(req: Request, signIn: () => Promise<T>): Promise<T> {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    this.failedLogins.assertNotBlocked(ip);
    try {
      return await signIn();
    } catch (err) {
      if (err instanceof InvalidCredentialsException) this.failedLogins.recordFailure(ip);
      throw err;
    }
  }

  @Post('refresh')
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') ua?: string,
  ) {
    const cookieMode = isCookieMode(req);
    // A token in the body wins: an older client, or the one-time move of a token still
    // in browser storage into the cookie. Otherwise the cookie, and only for a request
    // that sent the opt-in header; that header is the CSRF guard (a cross-site page
    // cannot send it without a CORS preflight, which our CORS refuses).
    const token = dto.refresh_token || (cookieMode ? readRefreshCookie(req) : null);
    if (!token) {
      if (cookieMode) clearRefreshCookie(res);
      throw new UnauthorizedException('Invalid refresh token');
    }
    try {
      return withRefreshCookie(req, res, await this.authService.refresh(token, ua));
    } catch (err) {
      // A refresh token the server refuses is dead: do not leave it in the browser.
      if (cookieMode) clearRefreshCookie(res);
      throw err;
    }
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('logout')
  async logout(
    @CurrentUser('id') userId: string,
    @CurrentUser('sid') sid: string | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logout(userId, sid);
    clearRefreshCookie(res);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out of every device (all sessions)' })
  @Post('logout-all')
  async logoutAll(@CurrentUser('id') userId: string, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.logoutAll(userId);
    clearRefreshCookie(res);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: any) {
    return { data: user };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the current user\'s password (self-service, no OTP)' })
  // Keyed by the signed-in user (no email in the body).
  @AuthRateLimit({ perAccount: { limit: 5, ttl: 15 * MINUTE } })
  @Patch('change-password')
  changePassword(
    @CurrentUser('id') userId: string,
    @CurrentUser('sid') sid: string | null,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto.password, sid);
  }

  // Called with the organisation-selection token: this is how a person enters a firm.
  @AllowSelectionToken()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('switch-org')
  async switchOrg(
    @CurrentUser('id') userId: string,
    @CurrentUser('sid') sid: string | null,
    @Body() dto: SwitchOrgDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') ua?: string,
  ) {
    return withRefreshCookie(req, res, await this.authService.switchOrg(userId, dto, sid, ua));
  }

  // Lists the firms to pick from, so it must accept the organisation-selection token too.
  @AllowSelectionToken()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('my-orgs')
  myOrgs(@CurrentUser('id') userId: string) {
    return this.authService.getMyOrgs(userId);
  }

  // ─── Google Calendar (per-user OAuth, own calendar) ───────────────────────────
  // The callback path (/api/v1/auth/google/callback) is what's registered with
  // Google, so these routes live on the auth controller. url/status/disconnect are
  // guarded; the callback is public (Google calls it) but carries a signed state.

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the Google consent URL to connect the current user\'s calendar' })
  @Get('google/url')
  googleUrl(@CurrentUser('id') userId: string) {
    return { url: this.googleAccounts.getConnectUrl(userId) };
  }

  @ApiOperation({ summary: 'OAuth redirect target — exchanges the code and stores the token' })
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: any,
  ) {
    const base = this.config.get<string>('FRONTEND_URL') ?? '';
    const dest = `${base}/dashboard/governance/meetings`;
    if (!code || !state) return res.redirect(`${dest}?gcal=error`);
    try {
      await this.googleAccounts.handleCallback(code, state);
      return res.redirect(`${dest}?gcal=connected`);
    } catch {
      return res.redirect(`${dest}?gcal=error`);
    }
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('google/status')
  googleStatus(@CurrentUser('id') userId: string) {
    return this.googleAccounts.getStatus(userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete('google')
  googleDisconnect(@CurrentUser('id') userId: string) {
    return this.googleAccounts.disconnect(userId);
  }

  // ─── Admin user management (super admin only) ─────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @SuperAdmin()
  @ApiBearerAuth()
  @Get('admins')
  listAdmins() {
    return this.authService.listAdmins();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @SuperAdmin()
  @ApiBearerAuth()
  @Post('admins')
  createAdmin(@Body() dto: CreateAdminDto) {
    return this.authService.createAdmin(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @SuperAdmin()
  @ApiBearerAuth()
  @Patch('admins/:id/toggle')
  toggleAdmin(
    @Param('id') id: string,
    @CurrentUser('id') requesterId: string,
    @Body() dto: ToggleAdminDto,
  ) {
    return this.authService.toggleAdmin(id, requesterId, dto.is_active);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @SuperAdmin()
  @ApiBearerAuth()
  @Put('admins/:id')
  updateAdmin(
    @Param('id') id: string,
    @Body() dto: UpdateAdminDto
  ) {
    return this.authService.updateAdmin(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @SuperAdmin()
  @ApiBearerAuth()
  @Delete('admins/:id')
  revokeAdmin(@Param('id') id: string, @CurrentUser('id') requesterId: string) {
    return this.authService.revokeAdmin(id, requesterId);
  }
}
