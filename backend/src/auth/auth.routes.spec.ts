/**
 * The authentication routes over HTTP (Supertest), wired the way production wires
 * them: the real AuthController and services, the global ValidationPipe and
 * GlobalExceptionFilter, the rate-limit guard (APP_GUARD) and the per-IP failed
 * sign-in limit, with `trust proxy` so X-Forwarded-For sets the client IP.
 * Only the datastore and the mailer are stand-ins.
 *
 * Rate-limit counters live for the whole file, so each test uses its own accounts
 * and IPs to stay independent.
 */
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { AUTH_MESSAGES } from './auth.messages';
import { GoogleAccountService } from '../gcal/google-account.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalExceptionFilter } from '../common/filters/http-exception.filter';
import { rateLimitConfig } from '../common/rate-limit/rate-limit.config';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { FAILED_LOGIN_LIMIT, FailedLoginLimiter } from '../common/rate-limit/failed-login.limiter';
import {
  PASSWORD,
  makeAuthPrisma,
  makeConfigMock,
  makeJwtMock,
  makeMembership,
  makeUser,
} from '../../test/helpers/auth-test-data';

const LOGIN = '/api/v1/auth/login';
const ADMIN_LOGIN = '/api/v1/auth/admin-login';
const FORGOT = '/api/v1/auth/forgot-password';

// In production every failed sign-in for an unknown account runs a full-cost (12)
// bcrypt check, so the response time does not reveal whether the account exists.
// That is tested in auth.login.spec.ts; here a cheap stand-in hash keeps the dozens
// of rate-limit requests fast. The behaviour under test is unchanged.
jest.mock('./auth.messages', () => ({
  ...jest.requireActual('./auth.messages'),
  TIMING_EQUALISER_HASH: jest.requireActual('bcryptjs').hashSync('timing-equaliser', 4),
}));
jest.setTimeout(30_000);

describe('auth routes over HTTP', () => {
  let app: NestExpressApplication;
  let prisma: ReturnType<typeof makeAuthPrisma>;
  let mail: { sendPasswordResetOtp: jest.Mock };
  let limiter: FailedLoginLimiter;

  beforeAll(async () => {
    prisma = makeAuthPrisma({
      users: [
        makeUser(),
        makeUser({ id: 'u-off', email: 'off@acme.com', phone: null, is_active: false }),
        makeUser({ id: 'u-admin', email: 'admin@v2e.io', phone: null, is_super_admin: true }),
      ],
      memberships: { 'u-asha': [makeMembership('org-1')] },
    });
    mail = { sendPasswordResetOtp: jest.fn(async () => undefined) };

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(rateLimitConfig)],
      controllers: [AuthController],
      providers: [
        AuthService,
        PasswordResetService,
        FailedLoginLimiter,
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        { provide: JwtService, useValue: makeJwtMock() },
        { provide: ConfigService, useValue: makeConfigMock() },
        { provide: GoogleAccountService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', 'loopback'); // the test client connects over loopback, like Next.js does
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    limiter = app.get(FailedLoginLimiter);
  });

  afterAll(async () => {
    await app.close();
  });

  /** POST a sign-in as if from `ip`. */
  const signIn = (path: string, body: object, ip = '198.51.100.1') =>
    request(app.getHttpServer()).post(path).set('X-Forwarded-For', ip).send(body);

  describe('POST /auth/login: responses', () => {
    it('the right credentials sign in', async () => {
      const res = await signIn(LOGIN, { identifier: 'asha@acme.com', password: PASSWORD }, '192.0.2.10').expect(201);
      expect(res.body.access_token).toBeDefined();
      expect(res.body.user).toMatchObject({ id: 'u-asha', organizationId: 'org-1' });
    });

    it('an unknown email: 401 with the generic message, in the standard error shape', async () => {
      const res = await signIn(LOGIN, { identifier: 'nobody-1@acme.com', password: PASSWORD }).expect(401);
      expect(res.body).toEqual({ success: false, data: null, message: AUTH_MESSAGES.invalidCredentials, meta: null });
    });

    it('a real email with the wrong password: exactly the same response', async () => {
      const res = await signIn(LOGIN, { identifier: 'asha@acme.com', password: 'wrong-pass' }, '192.0.2.11').expect(401);
      expect(res.body.message).toBe(AUTH_MESSAGES.invalidCredentials);
    });

    it('a short password is a 401 like any wrong password, not a 400 about the rules', async () => {
      const res = await signIn(LOGIN, { identifier: 'nobody-2@acme.com', password: 'abc' }).expect(401);
      expect(res.body.message).toBe(AUTH_MESSAGES.invalidCredentials);
    });

    it('empty fields: 400 with one plain sentence per field', async () => {
      const res = await signIn(LOGIN, { identifier: '', password: '' }).expect(400);
      expect(res.body.message).toBe('Enter your email address or mobile number. Enter your password.');
    });

    it('a deactivated account with the right password is told it was deactivated', async () => {
      const res = await signIn(LOGIN, { identifier: 'off@acme.com', password: PASSWORD }, '192.0.2.12').expect(401);
      expect(res.body.message).toBe(AUTH_MESSAGES.accountDeactivated);
    });
  });

  describe('POST /auth/admin-login: responses', () => {
    it('a super admin signs in', async () => {
      const res = await signIn(ADMIN_LOGIN, { identifier: 'admin@v2e.io', password: PASSWORD }, '192.0.2.20').expect(201);
      expect(res.body.user.isSuperAdmin).toBe(true);
    });

    it('a normal user with the right password gets the generic 401', async () => {
      const res = await signIn(ADMIN_LOGIN, { identifier: 'asha@acme.com', password: PASSWORD }, '192.0.2.21').expect(401);
      expect(res.body.message).toBe(AUTH_MESSAGES.invalidCredentials);
    });
  });

  describe('per-account rate limits', () => {
    it('the 11th login for one account from one IP within 15 minutes is refused with 429', async () => {
      const body = { identifier: 'limit-a@acme.com', password: 'wrong-pass' };
      for (let i = 0; i < 10; i++) await signIn(LOGIN, body, '203.0.113.1').expect(401);
      const res = await signIn(LOGIN, body, '203.0.113.1').expect(429);
      expect(res.body.message).toBe('Too many attempts. Please wait 15 minutes and try again.');
      expect(res.headers['retry-after-auth']).toBeDefined();
    });

    it('a colleague on the same IP signing in to their own account is not affected', async () => {
      const body = { identifier: 'limit-b@acme.com', password: 'wrong-pass' };
      for (let i = 0; i < 10; i++) await signIn(LOGIN, body, '203.0.113.2').expect(401);
      await signIn(LOGIN, body, '203.0.113.2').expect(429);
      await signIn(LOGIN, { identifier: 'colleague-b@acme.com', password: 'wrong-pass' }, '203.0.113.2').expect(401);
    });

    it('changing the capital letters of the email does not give more attempts', async () => {
      const body = { identifier: 'limit-c@acme.com', password: 'wrong-pass' };
      for (let i = 0; i < 10; i++) await signIn(LOGIN, body, '203.0.113.3').expect(401);
      await signIn(LOGIN, { ...body, identifier: 'LIMIT-C@Acme.COM' }, '203.0.113.3').expect(429);
    });

    it('writing the mobile number differently does not give more attempts', async () => {
      const formats = ['9000000077', '90000 00077', '090000-00077', '+91 9000000077'];
      for (let i = 0; i < 10; i++) {
        await signIn(LOGIN, { identifier: formats[i % 4], country_code: '+91', password: 'wrong-pass' }, '203.0.113.4').expect(401);
      }
      await signIn(LOGIN, { identifier: '9000000077', country_code: '+91', password: 'wrong-pass' }, '203.0.113.4').expect(429);
    });

    it('each IP has its own count for an account; the account total keeps counting', async () => {
      const body = { identifier: 'limit-d@acme.com', password: 'wrong-pass' };
      await signIn(LOGIN, body, '203.0.113.5').expect(401);
      const fromOtherIp = await signIn(LOGIN, body, '203.0.113.6').expect(401);
      expect(fromOtherIp.headers['x-ratelimit-remaining-auth']).toBe('9'); // fresh per-IP count
      expect(fromOtherIp.headers['x-ratelimit-remaining-account']).toBe('28'); // shared account count
    });

    it('an account is capped at 30 attempts in total, however many IPs are used', async () => {
      const body = { identifier: 'limit-e@acme.com', password: 'wrong-pass' };
      for (let i = 0; i < 30; i++) await signIn(LOGIN, body, `203.0.114.${i + 1}`).expect(401);
      await signIn(LOGIN, body, '203.0.114.200').expect(429);
    });

    it('the 6th admin login for one account from one IP is refused', async () => {
      const body = { identifier: 'limit-f@v2e.io', password: 'wrong-pass' };
      for (let i = 0; i < 5; i++) await signIn(ADMIN_LOGIN, body, '203.0.113.7').expect(401);
      await signIn(ADMIN_LOGIN, body, '203.0.113.7').expect(429);
    });
  });

  describe('per-IP failed sign-in limit', () => {
    it('an IP at the failure limit is refused BEFORE any account lookup or password check', async () => {
      for (let i = 0; i < FAILED_LOGIN_LIMIT; i++) limiter.recordFailure('203.0.113.50');
      prisma.user.findUnique.mockClear();
      const res = await signIn(LOGIN, { identifier: 'spray-new@acme.com', password: 'Company@123' }, '203.0.113.50').expect(429);
      expect(res.body.message).toBe(
        'Too many failed sign-in attempts from your network. Please wait 15 minutes and try again.',
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('the same limit applies to the admin portal', async () => {
      for (let i = 0; i < FAILED_LOGIN_LIMIT; i++) limiter.recordFailure('203.0.113.51');
      await signIn(ADMIN_LOGIN, { identifier: 'admin@v2e.io', password: PASSWORD }, '203.0.113.51').expect(429);
    });

    it('a wrong password counts as a failure for that IP', async () => {
      const spy = jest.spyOn(limiter, 'recordFailure');
      await signIn(LOGIN, { identifier: 'nobody-3@acme.com', password: 'wrong-pass' }, '203.0.113.52').expect(401);
      expect(spy).toHaveBeenCalledWith('203.0.113.52');
      spy.mockRestore();
    });

    it('a successful sign-in is not counted (a whole office can sign in together)', async () => {
      const spy = jest.spyOn(limiter, 'recordFailure');
      await signIn(LOGIN, { identifier: 'asha@acme.com', password: PASSWORD }, '203.0.113.53').expect(201);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('a deactivated account with the right password is not counted as a failed guess', async () => {
      const spy = jest.spyOn(limiter, 'recordFailure');
      await signIn(LOGIN, { identifier: 'off@acme.com', password: PASSWORD }, '203.0.113.54').expect(401);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('other IPs keep signing in while one IP is blocked', async () => {
      for (let i = 0; i < FAILED_LOGIN_LIMIT; i++) limiter.recordFailure('203.0.113.55');
      await signIn(LOGIN, { identifier: 'asha@acme.com', password: PASSWORD }, '203.0.113.56').expect(201);
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('an unknown email gets the same success answer as a real one and no email is sent', async () => {
      mail.sendPasswordResetOtp.mockClear();
      const unknown = await signIn(FORGOT, { email: 'nobody-4@acme.com' }, '203.0.113.60').expect(201);
      expect(unknown.body).toEqual({ success: true, message: AUTH_MESSAGES.resetCodeSent });
      expect(mail.sendPasswordResetOtp).not.toHaveBeenCalled();
    });

    it('a real email gets the same answer and one email', async () => {
      mail.sendPasswordResetOtp.mockClear();
      const real = await signIn(FORGOT, { email: 'asha@acme.com' }, '203.0.113.61').expect(201);
      expect(real.body).toEqual({ success: true, message: AUTH_MESSAGES.resetCodeSent });
      expect(mail.sendPasswordResetOtp).toHaveBeenCalledTimes(1);
    });

    it('the 6th request for one email from one IP within 15 minutes is refused', async () => {
      for (let i = 0; i < 5; i++) await signIn(FORGOT, { email: 'limit-g@acme.com' }, '203.0.113.62').expect(201);
      await signIn(FORGOT, { email: 'limit-g@acme.com' }, '203.0.113.62').expect(429);
    });

    it('an invalid email address is a 400', async () => {
      await signIn(FORGOT, { email: 'not-an-email' }, '203.0.113.63').expect(400);
    });
  });
});
