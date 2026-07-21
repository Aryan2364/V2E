import { Controller, Post, Body, UseGuards, Get, Param, Patch, Delete, Put, Query, Res } from '@nestjs/common';
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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SuperAdmin } from '../common/decorators/super-admin.decorator';

@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private passwordResetService: PasswordResetService,
    private googleAccounts: GoogleAccountService,
    private config: ConfigService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // ─── Self-service password reset (public, OTP by email) ───────────────────────

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordResetService.requestReset(dto.email);
  }

  @Post('reset-password/verify')
  verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.passwordResetService.verifyOtp(dto.email, dto.otp);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwordResetService.resetPassword(dto.email, dto.reset_token, dto.password);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('admin-login')
  adminLogin(@Body() dto: LoginDto) {
    return this.authService.adminLogin(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refresh_token);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('logout')
  logout(@CurrentUser('id') userId: string) {
    return this.authService.logout(userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: any) {
    return { data: user };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('switch-org')
  switchOrg(@CurrentUser('id') userId: string, @Body() dto: SwitchOrgDto) {
    return this.authService.switchOrg(userId, dto);
  }

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
  createAdmin(@Body() dto: { name: string; email: string; password: string }) {
    return this.authService.createAdmin(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @SuperAdmin()
  @ApiBearerAuth()
  @Patch('admins/:id/toggle')
  toggleAdmin(
    @Param('id') id: string,
    @CurrentUser('id') requesterId: string,
    @Body() dto: { is_active: boolean },
  ) {
    return this.authService.toggleAdmin(id, requesterId, dto.is_active);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @SuperAdmin()
  @ApiBearerAuth()
  @Put('admins/:id')
  updateAdmin(
    @Param('id') id: string,
    @Body() dto: { name?: string; email: string; password?: string }
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
