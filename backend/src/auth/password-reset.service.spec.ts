/**
 * Self-service password reset (forgot password -> 6-digit code -> new password),
 * against the REAL PasswordResetService with an in-memory datastore and a mail stub
 * that captures the code that would have been emailed.
 */
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PasswordResetService } from './password-reset.service';
import { AUTH_MESSAGES } from './auth.messages';
import { makeAuthPrisma, makeUser } from '../../test/helpers/auth-test-data';

function setup() {
  const prisma = makeAuthPrisma({ users: [makeUser()] });
  const mail = {
    sendPasswordResetOtp: jest.fn(
      async (_to: string, _otp: string) => undefined,
    ),
  };
  const service = new PasswordResetService(prisma, mail as any);
  /** The code in the most recent email. */
  const lastCode = () => mail.sendPasswordResetOtp.mock.calls.at(-1)![1];
  return { prisma, mail, service, lastCode };
}

async function rejection(
  promise: Promise<unknown>,
): Promise<BadRequestException> {
  try {
    await promise;
  } catch (err) {
    return err as BadRequestException;
  }
  throw new Error('expected the call to be refused');
}

describe('step 1: request a code (forgot password)', () => {
  it('an unknown email gets the same answer as a real one, and no email is sent', async () => {
    const { service, mail, prisma } = setup();
    const result = await service.requestReset('nobody@acme.com');
    expect(result).toEqual({
      success: true,
      message: AUTH_MESSAGES.resetCodeSent,
    });
    expect(mail.sendPasswordResetOtp).not.toHaveBeenCalled();
    expect(prisma.passwordReset.create).not.toHaveBeenCalled();
  });

  it('a real email gets the same answer and exactly one email with a 6-digit code', async () => {
    const { service, mail, lastCode } = setup();
    const result = await service.requestReset('asha@acme.com');
    expect(result).toEqual({
      success: true,
      message: AUTH_MESSAGES.resetCodeSent,
    });
    expect(mail.sendPasswordResetOtp).toHaveBeenCalledTimes(1);
    expect(lastCode()).toMatch(/^\d{6}$/);
  });

  it('spaces and capital letters in the email are ignored', async () => {
    const { service, mail } = setup();
    await service.requestReset('  Asha@ACME.com ');
    expect(mail.sendPasswordResetOtp).toHaveBeenCalledWith(
      'asha@acme.com',
      expect.any(String),
    );
  });

  it('the code is stored hashed, never as plain text', async () => {
    const { service, prisma, lastCode } = setup();
    await service.requestReset('asha@acme.com');
    const row = prisma.resets[0];
    expect(row.otp_hash).not.toBe(lastCode());
    expect(await bcrypt.compare(lastCode(), row.otp_hash)).toBe(true);
  });

  it('asking again within a minute does not send a second email', async () => {
    const { service, mail } = setup();
    await service.requestReset('asha@acme.com');
    const second = await service.requestReset('asha@acme.com');
    expect(second).toEqual({
      success: true,
      message: AUTH_MESSAGES.resetCodeSent,
    });
    expect(mail.sendPasswordResetOtp).toHaveBeenCalledTimes(1);
  });

  it('a new code replaces the old one once the minute has passed', async () => {
    const { service, prisma, mail } = setup();
    await service.requestReset('asha@acme.com');
    prisma.resets[0].created_at = new Date(Date.now() - 2 * 60_000); // sent 2 minutes ago
    await service.requestReset('asha@acme.com');
    expect(mail.sendPasswordResetOtp).toHaveBeenCalledTimes(2);
    expect(prisma.resets).toHaveLength(1); // only the newest code is kept
  });
});

describe('step 2: verify the code', () => {
  it('the right code returns a single-use reset token', async () => {
    const { service, lastCode } = setup();
    await service.requestReset('asha@acme.com');
    const { reset_token } = await service.verifyOtp(
      'asha@acme.com',
      lastCode(),
    );
    expect(reset_token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a code for an email that never asked for one is refused', async () => {
    const { service } = setup();
    const err = await rejection(service.verifyOtp('nobody@acme.com', '123456'));
    expect(err.message).toBe(
      'Invalid or expired code. Please request a new one.',
    );
  });

  it('a wrong code is refused and counted', async () => {
    const { service, prisma, lastCode } = setup();
    await service.requestReset('asha@acme.com');
    const wrong = lastCode() === '000000' ? '111111' : '000000';
    const err = await rejection(service.verifyOtp('asha@acme.com', wrong));
    expect(err.message).toBe('Incorrect code. Please try again.');
    expect(prisma.resets[0].attempts).toBe(1);
  });

  it('after 5 wrong codes even the right code is refused', async () => {
    const { service, lastCode } = setup();
    await service.requestReset('asha@acme.com');
    const right = lastCode();
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await rejection(service.verifyOtp('asha@acme.com', wrong));
    const err = await rejection(service.verifyOtp('asha@acme.com', right));
    expect(err.message).toBe(
      'Too many incorrect attempts. Please request a new code.',
    );
  });

  it('an expired code is refused', async () => {
    const { service, prisma, lastCode } = setup();
    await service.requestReset('asha@acme.com');
    prisma.resets[0].expires_at = new Date(Date.now() - 1000);
    const err = await rejection(service.verifyOtp('asha@acme.com', lastCode()));
    expect(err.message).toBe(
      'This code has expired. Please request a new one.',
    );
  });
});

describe('step 3: set the new password', () => {
  async function verified() {
    const ctx = setup();
    await ctx.service.requestReset('asha@acme.com');
    const { reset_token } = await ctx.service.verifyOtp(
      'asha@acme.com',
      ctx.lastCode(),
    );
    return { ...ctx, resetToken: reset_token };
  }

  it('sets the new password, signs out every device and uses up the token', async () => {
    const { service, prisma, resetToken } = await verified();
    await expect(
      service.resetPassword('asha@acme.com', resetToken, 'brand-new-pass'),
    ).resolves.toEqual({
      success: true,
    });
    const user = prisma.users[0];
    expect(await bcrypt.compare('brand-new-pass', user.password_hash)).toBe(
      true,
    );
    expect(user.refresh_token).toBeNull();
    expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
      where: { user_id: user.id },
    });
    expect(prisma.resets[0].consumed_at).toBeInstanceOf(Date);
  });

  it('the same token cannot be used twice', async () => {
    const { service, resetToken } = await verified();
    await service.resetPassword('asha@acme.com', resetToken, 'brand-new-pass');
    const err = await rejection(
      service.resetPassword('asha@acme.com', resetToken, 'another-pass'),
    );
    expect(err.message).toBe(
      'Invalid or expired reset request. Please start again.',
    );
  });

  it('a made-up token is refused', async () => {
    const { service } = await verified();
    const err = await rejection(
      service.resetPassword('asha@acme.com', 'f'.repeat(64), 'brand-new-pass'),
    );
    expect(err.message).toBe(
      'Invalid or expired reset request. Please start again.',
    );
  });

  it('a missing token is refused', async () => {
    const { service } = await verified();
    const err = await rejection(
      service.resetPassword('asha@acme.com', '', 'brand-new-pass'),
    );
    expect(err.message).toBe('Invalid or expired reset request.');
  });

  it('a token past its expiry is refused', async () => {
    const { service, prisma, resetToken } = await verified();
    prisma.resets[0].expires_at = new Date(Date.now() - 1000);
    const err = await rejection(
      service.resetPassword('asha@acme.com', resetToken, 'brand-new-pass'),
    );
    expect(err.message).toBe(
      'This reset request has expired. Please start again.',
    );
  });

  it("a token for one account cannot reset another account's password", async () => {
    const { service, resetToken } = await verified();
    const err = await rejection(
      service.resetPassword(
        'someone-else@acme.com',
        resetToken,
        'brand-new-pass',
      ),
    );
    expect(err.message).toBe(
      'Invalid or expired reset request. Please start again.',
    );
  });
});
