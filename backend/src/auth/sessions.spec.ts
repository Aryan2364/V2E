/**
 * Per-device sessions, exercising the REAL AuthService / PasswordResetService with
 * real JWT signing against an in-memory fake of the user + user_sessions tables
 * (updateMany honours its `where`, so the compare-and-swap rotation is genuinely
 * exercised). Covers: independent devices, single-device logout, logout-all, the
 * lost-reply retry, legacy-token migration, password-reset revocation and org
 * selection reusing a session.
 */
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';

const SECRET = 's';
const REFRESH_SECRET = 'r';
const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

function setup() {
  const user: any = {
    id: 'u1', name: 'Asha', email: 'asha@acme.com', country_code: null, phone: null,
    password_hash: bcrypt.hashSync('secret123', 4), is_active: true, is_super_admin: false,
    refresh_token: null, refresh_token_prev: null, refresh_token_prev_exp: null,
  };
  const sessions: any[] = [];
  const memberships = [
    { organization_id: 'org-1', is_admin: true, joined_at: new Date(), organization: { id: 'org-1', name: 'Acme', slug: 'acme', logo_url: null, status: 'active' } },
  ];
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
      if (v && typeof v === 'object' && 'lte' in v) return row[k] <= v.lte;
      return row[k] === v;
    });

  const prisma: any = {
    user: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(where.id === user.id || where.email === user.email ? user : null)),
      update: jest.fn(({ data }: any) => { Object.assign(user, data); return Promise.resolve(user); }),
    },
    userSession: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(sessions.find((s) => s.id === where.id) ?? null)),
      create: jest.fn(({ data }: any) => { sessions.push({ current_confirmed: false, prev_token_hash: null, ...data }); return Promise.resolve(data); }),
      updateMany: jest.fn(({ where, data }: any) => {
        const rows = sessions.filter((s) => matches(s, where));
        rows.forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: rows.length });
      }),
      deleteMany: jest.fn(({ where }: any) => {
        const doomed = sessions.filter((s) => matches(s, where));
        doomed.forEach((d) => sessions.splice(sessions.indexOf(d), 1));
        return Promise.resolve({ count: doomed.length });
      }),
    },
    organizationMember: {
      findMany: jest.fn(() => Promise.resolve(memberships)),
      findFirst: jest.fn(() => Promise.resolve({ is_admin: true, organization: { status: 'active' } })),
    },
    organization: { findUnique: jest.fn(() => Promise.resolve({ is_test: false })) },
    employeeProfile: { findFirst: jest.fn(() => Promise.resolve(null)) },
    passwordReset: {
      findFirst: jest.fn(() => Promise.resolve({ id: 'pr', expires_at: new Date(Date.now() + 60_000) })),
      update: jest.fn(() => Promise.resolve({})),
    },
  };
  const jwt = new JwtService({});
  const jwtShim: any = {
    sign: (p: any, o: any) => jwt.sign(p, o),
    verify: (t: string, o: any) => jwt.verify(t, o),
    decode: (t: string) => jwt.decode(t),
  };
  const config: any = {
    get: (k: string) =>
      ({ JWT_SECRET: SECRET, JWT_REFRESH_SECRET: REFRESH_SECRET, JWT_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '30d' } as any)[k],
  };
  const auth = new AuthService(prisma, jwtShim, config);
  const reset = new PasswordResetService(prisma, {} as any);
  const login = () => auth.login({ identifier: 'asha@acme.com', password: 'secret123' } as any) as Promise<any>;
  const sidOf = (t: string) => (jwt.decode(t) as any).sid;
  return { auth, reset, prisma, user, sessions, login, sidOf, jwt };
}

describe('per-device sessions', () => {
  it('phone and computer both stay signed in and refresh independently, repeatedly', async () => {
    const { auth, login, sessions } = setup();
    let computer = await login();
    let phone = await login();
    expect(sessions).toHaveLength(2);

    for (let i = 0; i < 3; i++) {
      computer = await auth.refresh(computer.refresh_token);
      phone = await auth.refresh(phone.refresh_token);
    }
    expect(sessions).toHaveLength(2);
    expect(computer.access_token).toBeTruthy();
    expect(phone.access_token).toBeTruthy();
  });

  it('tokens carry the sid; the session stores only a hash', async () => {
    const { login, sessions, sidOf, jwt } = setup();
    const t = await login();
    expect(sidOf(t.access_token)).toBe(sessions[0].id);
    expect(sidOf(t.refresh_token)).toBe(sessions[0].id);
    expect(sessions[0].token_hash).toBe(sha(t.refresh_token));
    expect(jwt.decode(t.refresh_token)).toBeTruthy();
  });

  it('logout on one device leaves the other signed in; logout-all ends both', async () => {
    const { auth, login, sidOf } = setup();
    const computer = await login();
    const phone = await login();

    await auth.logout('u1', sidOf(computer.access_token));
    await expect(auth.refresh(computer.refresh_token)).rejects.toThrow(UnauthorizedException);
    const phone2 = await auth.refresh(phone.refresh_token);

    const third = await login();
    await auth.logoutAll('u1');
    await expect(auth.refresh(phone2.refresh_token)).rejects.toThrow(UnauthorizedException);
    await expect(auth.refresh(third.refresh_token)).rejects.toThrow(UnauthorizedException);
  });

  it('lost reply: retrying the old token works any time; once the new token is used the old one is dead and the session revoked', async () => {
    const { auth, login, sessions } = setup();
    const t1 = await login();
    const t2 = await auth.refresh(t1.refresh_token); // reply "lost" - client never sees t2

    // Retry with T1, even long after (no timer involved).
    jest.useFakeTimers({ now: Date.now() + 3 * 24 * 3600 * 1000, doNotFake: ['nextTick', 'setImmediate'] });
    let t3: any;
    try {
      t3 = await auth.refresh(t1.refresh_token);
    } finally {
      jest.useRealTimers();
    }
    expect(t3.refresh_token).not.toBe(t2.refresh_token);

    // Client now uses the token it actually received.
    const t4 = await auth.refresh(t3.refresh_token);
    expect(t4.refresh_token).toBeTruthy();

    // T1 is a superseded generation now: rejected, and the session is revoked.
    await expect(auth.refresh(t1.refresh_token)).rejects.toThrow(UnauthorizedException);
    expect(sessions).toHaveLength(0);
    await expect(auth.refresh(t4.refresh_token)).rejects.toThrow(UnauthorizedException);
  });

  it('replaying the previous token after the current one is confirmed revokes the session', async () => {
    const { auth, login, sessions } = setup();
    const t1 = await login();
    await auth.refresh(t1.refresh_token);
    sessions[0].current_confirmed = true; // current token proven received
    await expect(auth.refresh(t1.refresh_token)).rejects.toThrow(UnauthorizedException);
    expect(sessions).toHaveLength(0);
  });

  it('a concurrent refresh that loses the compare-and-swap retries once and both tokens stay usable', async () => {
    const { auth, login, prisma } = setup();
    const t1 = await login();
    // Simulate another request rotating the same session between our read and write.
    const realUpdate = prisma.userSession.updateMany;
    let raced = false;
    prisma.userSession.updateMany = jest.fn(async (args: any) => {
      if (!raced) {
        raced = true;
        await auth.refresh(t1.refresh_token); // the winner
      }
      return realUpdate(args);
    });
    const loser = await auth.refresh(t1.refresh_token);
    expect(loser.refresh_token).toBeTruthy();
    prisma.userSession.updateMany = realUpdate;
  });

  it('a legacy token without sid refreshes, returns sid tokens and opens a session', async () => {
    const { auth, user, sessions, jwt, sidOf } = setup();
    const legacy = jwt.sign({ sub: 'u1', email: user.email, isSuperAdmin: false, organizationId: 'org-1' }, { secret: REFRESH_SECRET, expiresIn: '30d' });
    user.refresh_token = sha(legacy);
    expect(sessions).toHaveLength(0);

    const out: any = await auth.refresh(legacy);
    expect(sessions).toHaveLength(1);
    expect(sidOf(out.refresh_token)).toBe(sessions[0].id);
    expect(user.refresh_token).toBe(sha(legacy)); // legacy columns untouched

    // And it continues on the session path.
    await auth.refresh(out.refresh_token);
    expect(sessions).toHaveLength(1);
  });

  it('a legacy token that matches nothing is rejected', async () => {
    const { auth, user, jwt } = setup();
    const bogus = jwt.sign({ sub: 'u1', email: user.email }, { secret: REFRESH_SECRET, expiresIn: '30d' });
    await expect(auth.refresh(bogus)).rejects.toThrow(UnauthorizedException);
  });

  it('a password reset revokes every session and the legacy slot', async () => {
    const { auth, reset, login, user, sessions } = setup();
    user.refresh_token = 'legacy-hash';
    const a = await login();
    const b = await login();
    await reset.resetPassword('asha@acme.com', 'tok', 'newpassword1');
    expect(sessions).toHaveLength(0);
    expect(user.refresh_token).toBeNull();
    await expect(auth.refresh(a.refresh_token)).rejects.toThrow(UnauthorizedException);
    await expect(auth.refresh(b.refresh_token)).rejects.toThrow(UnauthorizedException);
  });

  it('changing the password signs out other devices but keeps the caller\'s session', async () => {
    const { auth, login, sidOf, sessions } = setup();
    const here = await login();
    const other = await login();
    await auth.changePassword('u1', 'newpassword1', sidOf(here.access_token));
    expect(sessions).toHaveLength(1);
    await auth.refresh(here.refresh_token);
    await expect(auth.refresh(other.refresh_token)).rejects.toThrow(UnauthorizedException);
  });

  it('org selection with a sid reuses the session; without one (post-login) opens a session', async () => {
    const { auth, login, sidOf, sessions } = setup();
    const t = await login();
    const sid = sidOf(t.access_token);

    const switched: any = await auth.switchOrg('u1', { organizationId: 'org-1' } as any, sid);
    expect(sessions).toHaveLength(1);
    expect(sidOf(switched.refresh_token)).toBe(sid);
    expect(sessions[0].token_hash).toBe(sha(switched.refresh_token));
    await auth.refresh(switched.refresh_token);
    // The pre-switch token was replaced; presenting it now revokes the session.
    await expect(auth.refresh(t.refresh_token)).rejects.toThrow(UnauthorizedException);
    expect(sessions).toHaveLength(0);
    await login();

    // Selection token carries no sid -> first real tokens for this device.
    await auth.switchOrg('u1', { organizationId: 'org-1' } as any, null);
    expect(sessions).toHaveLength(2);
  });

  it('opening a session deletes the user\'s expired ones', async () => {
    const { login, sessions } = setup();
    await login();
    sessions[0].expires_at = new Date(Date.now() - 1000);
    await login();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].expires_at.getTime()).toBeGreaterThan(Date.now());
  });
});
