/**
 * The signed-in side of authentication over HTTP (Supertest): /me, logout,
 * change password, choosing an organisation, refresh with the httpOnly cookie,
 * the super-admin routes, and registration.
 *
 * Unlike auth.routes.spec.ts, tokens here are REAL signed JWTs, checked by the real
 * JwtStrategy, JwtAuthGuard and RolesGuard, so these tests exercise the actual
 * security gates. Only the datastore, mailer and Google client are stand-ins.
 */
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { REFRESH_COOKIE } from './auth-cookie';
import { GoogleAccountService } from '../gcal/google-account.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalExceptionFilter } from '../common/filters/http-exception.filter';
import { DEFAULT_ERROR_MESSAGES } from '../common/http/error-messages';
import { rateLimitConfig } from '../common/rate-limit/rate-limit.config';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { FailedLoginLimiter } from '../common/rate-limit/failed-login.limiter';
import {
  PASSWORD,
  TEST_CONFIG,
  makeAuthPrisma,
  makeConfigMock,
  makeMembership,
  makeUser,
} from '../../test/helpers/auth-test-data';

// Cheap stand-in for the cost-12 timing hash (tested in auth.login.spec.ts).
jest.mock('./auth.messages', () => ({
  ...jest.requireActual('./auth.messages'),
  TIMING_EQUALISER_HASH: jest.requireActual('bcryptjs').hashSync('timing-equaliser', 4),
}));

const AUTH = '/api/v1/auth';

describe('signed-in auth routes over HTTP', () => {
  let app: NestExpressApplication;
  let prisma: ReturnType<typeof makeAuthPrisma>;
  const previousSecret = process.env.JWT_SECRET;

  // Each request comes from its own IP so the per-IP sign-in limits never interfere.
  let ipSeq = 0;
  const nextIp = () => `198.18.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

  beforeAll(async () => {
    // The rate-limit guard reads the access secret from the environment.
    process.env.JWT_SECRET = TEST_CONFIG.JWT_SECRET;
    prisma = makeAuthPrisma({
      users: [
        makeUser({ id: 'u-asha', email: 'asha@acme.com' }),
        makeUser({ id: 'u-ravi', email: 'ravi@acme.com', phone: null }),
        makeUser({ id: 'u-meera', email: 'meera@acme.com', phone: null }),
        makeUser({ id: 'u-dev', email: 'dev@acme.com', phone: null }),
        makeUser({ id: 'u-multi', email: 'multi@acme.com', phone: null }),
        makeUser({ id: 'u-admin', email: 'admin@v2e.io', phone: null, is_super_admin: true }),
        makeUser({ id: 'u-admin2', email: 'admin2@v2e.io', phone: null, is_super_admin: true }),
      ],
      memberships: {
        'u-asha': [makeMembership('org-1')],
        'u-ravi': [makeMembership('org-1')],
        'u-meera': [makeMembership('org-1')],
        'u-dev': [makeMembership('org-1')],
        'u-multi': [makeMembership('org-1'), makeMembership('org-2')],
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, ThrottlerModule.forRoot(rateLimitConfig)],
      controllers: [AuthController],
      providers: [
        AuthService,
        PasswordResetService,
        JwtStrategy,
        FailedLoginLimiter,
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: { sendPasswordResetOtp: jest.fn(async () => undefined) } },
        { provide: JwtService, useValue: new JwtService({}) },
        { provide: ConfigService, useValue: makeConfigMock() },
        { provide: GoogleAccountService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', 'loopback');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.JWT_SECRET = previousSecret;
  });

  const http = () => request(app.getHttpServer());

  /** Sign in and return the response body (tokens in the body: a non-cookie client). */
  async function signIn(email: string, password = PASSWORD) {
    const res = await http().post(`${AUTH}/login`).set('X-Forwarded-For', nextIp()).send({ identifier: email, password });
    return res;
  }
  async function tokensFor(email: string) {
    const res = await signIn(email);
    expect(res.status).toBe(201);
    return res.body as { access_token: string; refresh_token: string };
  }
  async function adminToken(email = 'admin@v2e.io') {
    const res = await http()
      .post(`${AUTH}/admin-login`)
      .set('X-Forwarded-For', nextIp())
      .send({ identifier: email, password: PASSWORD });
    expect(res.status).toBe(201);
    return res.body.access_token as string;
  }
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('GET /auth/me', () => {
    it('without a token: 401 with the plain session sentence', async () => {
      const res = await http().get(`${AUTH}/me`).expect(401);
      expect(res.body.message).toBe(DEFAULT_ERROR_MESSAGES[401]);
    });

    it('with a valid token: the signed-in person and their organisation', async () => {
      const { access_token } = await tokensFor('asha@acme.com');
      const res = await http().get(`${AUTH}/me`).set(bearer(access_token)).expect(200);
      expect(res.body.data).toMatchObject({ id: 'u-asha', organizationId: 'org-1', isSuperAdmin: false });
    });

    it('with a tampered token: 401', async () => {
      const { access_token } = await tokensFor('asha@acme.com');
      const [head, payload, sig] = access_token.split('.');
      const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), isSuperAdmin: true })).toString('base64url');
      await http().get(`${AUTH}/me`).set(bearer(`${head}.${forged}.${sig}`)).expect(401);
    });

    it('with a token signed by someone else: 401', async () => {
      const fake = new JwtService({}).sign({ sub: 'u-asha', organizationId: 'org-1' }, { secret: 'attacker-secret' });
      await http().get(`${AUTH}/me`).set(bearer(fake)).expect(401);
    });

    it('with a refresh token used as an access token: 401 (different secret)', async () => {
      const { refresh_token } = await tokensFor('asha@acme.com');
      await http().get(`${AUTH}/me`).set(bearer(refresh_token)).expect(401);
    });

    it('a person deactivated after signing in is refused on the next request', async () => {
      const { access_token } = await tokensFor('dev@acme.com');
      const dev = prisma.users.find((u: any) => u.id === 'u-dev')!;
      dev.is_active = false;
      try {
        await http().get(`${AUTH}/me`).set(bearer(access_token)).expect(401);
      } finally {
        dev.is_active = true;
      }
    });
  });

  describe('choosing an organisation (selection token)', () => {
    async function selectionToken() {
      const res = await signIn('multi@acme.com');
      expect(res.body.requires_org_selection).toBe(true);
      return res.body.selection_token as string;
    }

    it('the selection token is NOT a session: /me refuses it', async () => {
      const res = await http().get(`${AUTH}/me`).set(bearer(await selectionToken())).expect(401);
      expect(res.body.message).toBe('Choose an organisation to continue.');
    });

    it('it can list the person\'s organisations', async () => {
      const res = await http().get(`${AUTH}/my-orgs`).set(bearer(await selectionToken())).expect(200);
      expect(res.body.map((m: any) => m.organization_id)).toEqual(['org-1', 'org-2']);
    });

    it('it can switch into one of them, which gives a real session for that organisation', async () => {
      const res = await http()
        .post(`${AUTH}/switch-org`)
        .set(bearer(await selectionToken()))
        .send({ organizationId: 'org-2' })
        .expect(201);
      expect(res.body.user.organizationId).toBe('org-2');
      await http().get(`${AUTH}/me`).set(bearer(res.body.access_token)).expect(200);
    });

    it('it cannot switch into an organisation the person does not belong to', async () => {
      const res = await http()
        .post(`${AUTH}/switch-org`)
        .set(bearer(await selectionToken()))
        .send({ organizationId: 'someone-elses-org' })
        .expect(403);
      expect(res.body.message).toBe('Not a member of this organization');
    });

    it('switching needs an organisation id', async () => {
      await http().post(`${AUTH}/switch-org`).set(bearer(await selectionToken())).send({}).expect(400);
    });
  });

  describe('logout', () => {
    it('logout ends this device\'s session: its refresh token stops working', async () => {
      const { access_token, refresh_token } = await tokensFor('ravi@acme.com');
      await http().post(`${AUTH}/logout`).set(bearer(access_token)).expect(201);
      await http().post(`${AUTH}/refresh`).send({ refresh_token }).expect(401);
    });

    it('logout on one device leaves the other device signed in', async () => {
      const phone = await tokensFor('ravi@acme.com');
      const laptop = await tokensFor('ravi@acme.com');
      await http().post(`${AUTH}/logout`).set(bearer(phone.access_token)).expect(201);
      await http().post(`${AUTH}/refresh`).send({ refresh_token: laptop.refresh_token }).expect(201);
    });

    it('logout-all ends every device\'s session', async () => {
      const phone = await tokensFor('ravi@acme.com');
      const laptop = await tokensFor('ravi@acme.com');
      await http().post(`${AUTH}/logout-all`).set(bearer(phone.access_token)).expect(201);
      await http().post(`${AUTH}/refresh`).send({ refresh_token: phone.refresh_token }).expect(401);
      await http().post(`${AUTH}/refresh`).send({ refresh_token: laptop.refresh_token }).expect(401);
    });

    it('logout needs a signed-in person', async () => {
      await http().post(`${AUTH}/logout`).expect(401);
    });
  });

  describe('PATCH /auth/change-password', () => {
    it('a new password shorter than 8 characters is refused', async () => {
      const { access_token } = await tokensFor('meera@acme.com');
      await http().patch(`${AUTH}/change-password`).set(bearer(access_token)).send({ password: 'short' }).expect(400);
    });

    it('changes the password: the new one signs in, the old one does not, other devices are signed out', async () => {
      const other = await tokensFor('meera@acme.com');
      const current = await tokensFor('meera@acme.com');
      await http()
        .patch(`${AUTH}/change-password`)
        .set(bearer(current.access_token))
        .send({ password: 'new-password-1' })
        .expect(200);
      expect((await signIn('meera@acme.com', 'new-password-1')).status).toBe(201);
      expect((await signIn('meera@acme.com', PASSWORD)).status).toBe(401);
      await http().post(`${AUTH}/refresh`).send({ refresh_token: other.refresh_token }).expect(401);
      await http().post(`${AUTH}/refresh`).send({ refresh_token: current.refresh_token }).expect(201);
      // Put it back for the other tests.
      const meera = prisma.users.find((u: any) => u.id === 'u-meera')!;
      meera.password_hash = prisma.users.find((u: any) => u.id === 'u-asha')!.password_hash;
    });

    it('is limited to 5 changes per 15 minutes per person; other people are not affected', async () => {
      const { access_token } = await tokensFor('asha@acme.com');
      for (let i = 0; i < 5; i++) {
        await http().patch(`${AUTH}/change-password`).set(bearer(access_token)).send({ password: PASSWORD }).expect(200);
      }
      const blocked = await http().patch(`${AUTH}/change-password`).set(bearer(access_token)).send({ password: PASSWORD }).expect(429);
      expect(blocked.body.message).toMatch(/^Too many attempts\. Please wait \d+ minutes? and try again\.$/);
      const ravi = await tokensFor('ravi@acme.com');
      await http().patch(`${AUTH}/change-password`).set(bearer(ravi.access_token)).send({ password: PASSWORD }).expect(200);
    });

    it('needs a signed-in person', async () => {
      await http().patch(`${AUTH}/change-password`).send({ password: 'new-password-1' }).expect(401);
    });
  });

  describe('POST /auth/refresh with the httpOnly cookie', () => {
    const cookieClient = { 'X-V2E-Auth': 'cookie' };

    async function cookieSignIn() {
      const res = await http()
        .post(`${AUTH}/login`)
        .set(cookieClient)
        .set('X-Forwarded-For', nextIp())
        .send({ identifier: 'asha@acme.com', password: PASSWORD })
        .expect(201);
      const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      const refreshCookie = setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE}=`))!;
      return { res, refreshCookie, cookiePair: refreshCookie.split(';')[0] };
    }

    it('sign-in sets an httpOnly, SameSite=Strict cookie on the auth path and keeps the token out of the body', async () => {
      const { res, refreshCookie } = await cookieSignIn();
      expect(refreshCookie).toMatch(/HttpOnly/i);
      expect(refreshCookie).toMatch(/SameSite=Strict/i);
      expect(refreshCookie).toMatch(/Path=\/api\/v1\/auth/);
      expect(res.body.refresh_token).toBeUndefined();
      expect(res.body.access_token).toBeDefined();
    });

    it('refresh with the cookie gives a new access token and a rotated cookie', async () => {
      const { cookiePair } = await cookieSignIn();
      const res = await http().post(`${AUTH}/refresh`).set(cookieClient).set('Cookie', cookiePair).expect(201);
      expect(res.body.access_token).toBeDefined();
      expect(res.body.refresh_token).toBeUndefined();
      const rotated = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
      expect(rotated).toBeDefined();
      expect(rotated!.split(';')[0]).not.toBe(cookiePair);
    });

    it('the cookie alone is not enough: without the opt-in header it is ignored (CSRF guard)', async () => {
      const { cookiePair } = await cookieSignIn();
      await http().post(`${AUTH}/refresh`).set('Cookie', cookiePair).expect(401);
    });

    it('no token at all: 401 and the cookie is cleared', async () => {
      const res = await http().post(`${AUTH}/refresh`).set(cookieClient).expect(401);
      const cleared = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it('a refused token is removed from the browser', async () => {
      const res = await http()
        .post(`${AUTH}/refresh`)
        .set(cookieClient)
        .set('Cookie', `${REFRESH_COOKIE}=not-a-real-token`)
        .expect(401);
      expect(res.body.message).toBe('Invalid refresh token');
      const cleared = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it('older clients can still refresh with the token in the body', async () => {
      const { refresh_token } = await tokensFor('asha@acme.com');
      const res = await http().post(`${AUTH}/refresh`).send({ refresh_token }).expect(201);
      expect(res.body.refresh_token).toBeDefined();
    });
  });

  describe('super-admin routes (/auth/admins)', () => {
    it('without a token: 401', async () => {
      await http().get(`${AUTH}/admins`).expect(401);
    });

    it('a normal signed-in user: 403', async () => {
      const { access_token } = await tokensFor('asha@acme.com');
      const res = await http().get(`${AUTH}/admins`).set(bearer(access_token)).expect(403);
      expect(res.body.message).toBe('Super admin required');
    });

    it('a normal user cannot create, revoke or deactivate admins either', async () => {
      const { access_token } = await tokensFor('asha@acme.com');
      await http().post(`${AUTH}/admins`).set(bearer(access_token)).send({ name: 'x', email: 'x@v2e.io', password: 'x-pass-123' }).expect(403);
      await http().delete(`${AUTH}/admins/u-admin2`).set(bearer(access_token)).expect(403);
      await http().patch(`${AUTH}/admins/u-admin2/toggle`).set(bearer(access_token)).send({ is_active: false }).expect(403);
    });

    it('a super admin can list the admins', async () => {
      const res = await http().get(`${AUTH}/admins`).set(bearer(await adminToken())).expect(200);
      expect(res.body.map((a: any) => a.id).sort()).toEqual(['u-admin', 'u-admin2']);
    });

    it('a super admin cannot revoke or deactivate themselves over the API', async () => {
      const token = await adminToken();
      const revoke = await http().delete(`${AUTH}/admins/u-admin`).set(bearer(token)).expect(403);
      expect(revoke.body.message).toBe('You cannot revoke your own super admin access.');
      const toggle = await http().patch(`${AUTH}/admins/u-admin/toggle`).set(bearer(token)).send({ is_active: false }).expect(403);
      expect(toggle.body.message).toBe('You cannot deactivate your own account.');
    });
  });

  describe('POST /auth/register', () => {
    const register = (body: object, ip = nextIp()) =>
      http().post(`${AUTH}/register`).set('X-Forwarded-For', ip).send(body);

    it('creates a personal account and signs it in', async () => {
      const res = await register({ name: 'Nina', email: 'nina@example.com', password: 'nina-pass-1' }).expect(201);
      expect(res.body.access_token).toBeDefined();
      expect(prisma.users.some((u: any) => u.email === 'nina@example.com')).toBe(true);
    });

    it('an email that is already registered is refused with 409', async () => {
      const res = await register({ name: 'Asha 2', email: 'asha@acme.com', password: 'another-pass' }).expect(409);
      expect(res.body.message).toBe('Email already registered');
    });

    it('an invalid email or missing name is refused with 400', async () => {
      await register({ name: 'X', email: 'not-an-email', password: 'valid-pass-1' }).expect(400);
      await register({ email: 'noname@example.com', password: 'valid-pass-1' }).expect(400);
    });

    it('is limited to 10 attempts per hour for one email from one IP', async () => {
      const body = { name: 'Spam', email: 'asha@acme.com', password: 'another-pass' };
      for (let i = 0; i < 10; i++) await register(body, '198.19.0.1').expect(409);
      await register(body, '198.19.0.1').expect(429);
    });
  });

  describe('POST /auth/reset-password/verify (code guessing)', () => {
    it('is limited to 5 guesses per 15 minutes for one email from one IP', async () => {
      const body = { email: 'asha@acme.com', otp: '000000' };
      for (let i = 0; i < 5; i++) {
        await http().post(`${AUTH}/reset-password/verify`).set('X-Forwarded-For', '198.19.0.2').send(body).expect(400);
      }
      await http().post(`${AUTH}/reset-password/verify`).set('X-Forwarded-For', '198.19.0.2').send(body).expect(429);
    });
  });
});
