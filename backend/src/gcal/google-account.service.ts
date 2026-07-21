import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { GcalApiService } from './gcal-api.service';

// How long a connect flow may stay open before the signed state expires.
const STATE_TTL_MS = 15 * 60 * 1000;

// Owns the per-USER Google connection: the OAuth handshake, the encrypted
// refresh token, and connect/status/disconnect. The token is global to the user
// (their own calendar), never per-org — so this is org-agnostic on purpose.
@Injectable()
export class GoogleAccountService {
  private readonly logger = new Logger(GoogleAccountService.name);
  private readonly stateSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly enc: EncryptionService,
    private readonly api: GcalApiService,
    config: ConfigService,
  ) {
    this.stateSecret = config.get<string>('JWT_SECRET') ?? 'insecure-dev-key';
  }

  get isConfigured(): boolean {
    return this.api.isConfigured;
  }

  // ─── Signed OAuth state (anti-CSRF) ─────────────────────────────────────────
  // Carries the userId through Google's redirect without a server session, and
  // is HMAC-signed so an attacker can't forge a callback that binds THEIR Google
  // account to another user (or vice versa). Format: base64url(userId.exp.sig).
  private signState(userId: string): string {
    const exp = String(Date.now() + STATE_TTL_MS);
    const body = `${userId}.${exp}`;
    const sig = createHmac('sha256', this.stateSecret).update(body).digest('base64url');
    return Buffer.from(`${body}.${sig}`).toString('base64url');
  }

  private verifyState(state: string): string {
    let decoded: string;
    try {
      decoded = Buffer.from(state, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException('Invalid OAuth state');
    }
    const [userId, exp, sig] = decoded.split('.');
    if (!userId || !exp || !sig) throw new BadRequestException('Invalid OAuth state');
    const expected = createHmac('sha256', this.stateSecret).update(`${userId}.${exp}`).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('OAuth state signature mismatch');
    }
    if (Date.now() > Number(exp)) throw new BadRequestException('OAuth state expired');
    return userId;
  }

  // ─── Connect flow ────────────────────────────────────────────────────────────
  getConnectUrl(userId: string): string {
    if (!this.isConfigured) {
      throw new BadRequestException('Google Calendar is not configured on this server.');
    }
    return this.api.getAuthUrl(this.signState(userId));
  }

  // Verify state → exchange code → store the encrypted token. Returns the userId
  // so the controller can redirect that user back to the app.
  async handleCallback(code: string, state: string): Promise<string> {
    const userId = this.verifyState(state);
    const { refreshToken } = await this.api.exchangeCode(code);
    await this.prisma.user.update({
      where: { id: userId },
      data: { google_refresh_token: this.enc.encrypt(refreshToken) },
    });
    return userId;
  }

  async getStatus(userId: string): Promise<{ connected: boolean; configured: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { google_refresh_token: true },
    });
    return { connected: !!user?.google_refresh_token, configured: this.isConfigured };
  }

  async disconnect(userId: string): Promise<{ success: true }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { google_refresh_token: null },
    });
    return { success: true };
  }

  // Decrypted refresh token for a user, or null if not connected / unreadable.
  // The single choke point the sync service goes through to act as a user.
  async getRefreshToken(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { google_refresh_token: true },
    });
    return this.enc.decryptSafe(user?.google_refresh_token);
  }
}
