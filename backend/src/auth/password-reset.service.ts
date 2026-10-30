import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

const OTP_TTL_MS = 10 * 60 * 1000; // codes are valid for 10 minutes
const MAX_ATTEMPTS = 5; // wrong-OTP guesses allowed before a new code is required
const RESEND_COOLDOWN_MS = 60 * 1000; // min gap between sends to the same email

/**
 * Self-service password reset via a 6-digit email OTP. Three steps:
 *   1. requestReset  — email a code (rate-limited)
 *   2. verifyOtp     — confirm the code, mint a single-use reset token
 *   3. resetPassword — set the new password with that token
 * OTPs are stored hashed; only the newest un-consumed row per email is valid.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  /** Step 1 — user submits their email; we email a fresh 6-digit code. */
  async requestReset(email: string) {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });

    if (!user) {
      throw new BadRequestException('No account found with that email address.');
    }

    // Anti-spam: if a still-valid code was sent less than a minute ago, don't
    // send another — clicking "send" 100 times yields at most one email/minute.
    const recent = await this.prisma.passwordReset.findFirst({
      where: { email: normalized, consumed_at: null },
      orderBy: { created_at: 'desc' },
    });
    if (
      recent &&
      recent.expires_at.getTime() > Date.now() &&
      Date.now() - recent.created_at.getTime() < RESEND_COOLDOWN_MS
    ) {
      return { success: true };
    }

    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const otp_hash = await bcrypt.hash(otp, 10);
    const expires_at = new Date(Date.now() + OTP_TTL_MS);

    // Only the newest code should be valid — drop any earlier pending rows.
    await this.prisma.passwordReset.deleteMany({ where: { email: normalized } });
    await this.prisma.passwordReset.create({
      data: { email: normalized, otp_hash, expires_at },
    });

    await this.mail.sendPasswordResetOtp(normalized, otp);
    return { success: true };
  }

  /** Step 2 — verify the OTP; on success mint an opaque single-use reset token. */
  async verifyOtp(email: string, otp: string) {
    const normalized = email.trim().toLowerCase();
    const row = await this.prisma.passwordReset.findFirst({
      where: { email: normalized, consumed_at: null },
      orderBy: { created_at: 'desc' },
    });

    if (!row) throw new BadRequestException('Invalid or expired code. Please request a new one.');
    if (row.expires_at.getTime() < Date.now()) {
      throw new BadRequestException('This code has expired. Please request a new one.');
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('Too many incorrect attempts. Please request a new code.');
    }

    const match = await bcrypt.compare(otp, row.otp_hash);
    if (!match) {
      await this.prisma.passwordReset.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Incorrect code. Please try again.');
    }

    const reset_token = randomBytes(32).toString('hex');
    await this.prisma.passwordReset.update({
      where: { id: row.id },
      data: { reset_token },
    });
    return { reset_token };
  }

  /** Step 3 — set the new password using the token from step 2, then consume it. */
  async resetPassword(email: string, resetToken: string, newPassword: string) {
    const normalized = email.trim().toLowerCase();
    if (!resetToken) throw new BadRequestException('Invalid or expired reset request.');

    const row = await this.prisma.passwordReset.findFirst({
      where: { email: normalized, reset_token: resetToken, consumed_at: null },
    });
    if (!row) throw new BadRequestException('Invalid or expired reset request. Please start again.');
    if (row.expires_at.getTime() < Date.now()) {
      throw new BadRequestException('This reset request has expired. Please start again.');
    }

    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user) throw new BadRequestException('Invalid or expired reset request. Please start again.');

    const password_hash = await bcrypt.hash(newPassword, 12);
    // Set the new password AND invalidate all existing sessions (refresh tokens),
    // so a reset also boots any attacker who may have had a live session.
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password_hash,
        refresh_token: null,
        refresh_token_prev: null,
        refresh_token_prev_exp: null,
      },
    });
    await this.prisma.userSession.deleteMany({ where: { user_id: user.id } });
    await this.prisma.passwordReset.update({
      where: { id: row.id },
      data: { consumed_at: new Date() },
    });

    return { success: true };
  }
}
