/**
 * WebSocket handshake authentication (SECURITY_AUDIT C4/C5 — engine).
 *
 * The notification and chat gateways used to trust a client-supplied `userId`
 * in the handshake with NO token verification, so anyone could claim any user's
 * id in any org. WsAuthService is the fix's engine: it resolves the trusted
 * principal SOLELY from a verified access-token JWT and returns null on any
 * failure so the gateway can refuse the connection.
 *
 * These tests use the REAL JwtService (so signature + expiry verification is
 * genuinely exercised) and mock only the datastore boundary (Prisma user
 * lookup), mirroring the C1 test's philosophy.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WsAuthService } from './ws-auth.service';
import { PrismaService } from '../prisma/prisma.service';

const SECRET = 'test-ws-secret';

describe('WsAuthService (SECURITY_AUDIT C4/C5)', () => {
  let svc: WsAuthService;
  let jwt: JwtService;
  const prisma = {
    user: { findUnique: jest.fn() },
    organization: { findUnique: jest.fn() },
  };

  const sign = (payload: object, opts: object = {}) =>
    jwt.sign(payload, { secret: SECRET, ...opts });

  // A socket double carrying only what the auth path reads.
  const socketWith = (auth: any, headers: any = {}) =>
    ({ handshake: { auth, headers } }) as any;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: SECRET })],
      providers: [
        WsAuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) },
        },
      ],
    }).compile();

    svc = moduleRef.get(WsAuthService);
    jwt = moduleRef.get(JwtService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: the token's subject is a real, active user.
    prisma.user.findUnique.mockResolvedValue({ id: 'user-A', is_active: true });
    // Default: the token's org is a live firm (not deactivated by a super admin).
    prisma.organization.findUnique.mockResolvedValue({ status: 'active' });
  });

  // ─── The hole: no token / spoofed id ──────────────────────────────────────

  it('rejects a handshake that carries a spoofed userId but NO token (the C4/C5 hole)', async () => {
    const result = await svc.authenticate(socketWith({ userId: 'victim' }));
    expect(result).toBeNull();
    // Must not even hit the DB — there is nothing to look up.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an empty handshake', async () => {
    expect(await svc.authenticate(socketWith({}))).toBeNull();
    expect(await svc.authenticate(socketWith(undefined))).toBeNull();
  });

  // ─── The fix: identity comes from the verified token only ──────────────────

  it('accepts a validly-signed token and returns the token-derived principal', async () => {
    const token = sign({ sub: 'user-A', email: 'a@x.example', organizationId: 'org-1' });
    const result = await svc.authenticate(socketWith({ token }));
    expect(result).toEqual({ userId: 'user-A', organizationId: 'org-1' });
  });

  it('IGNORES a client-supplied userId and trusts only the token subject (anti-impersonation)', async () => {
    // Attacker signs a token for themselves (user-A) but also stuffs a victim id
    // into the handshake. The verified subject must win.
    const token = sign({ sub: 'user-A', organizationId: 'org-1' });
    const result = await svc.authenticate(socketWith({ token, userId: 'victim', orgId: 'other-org' }));
    expect(result).toEqual({ userId: 'user-A', organizationId: 'org-1' });
  });

  it('reads the token from the Authorization header too (polling-transport fallback)', async () => {
    const token = sign({ sub: 'user-A', organizationId: 'org-1' });
    const result = await svc.authenticate(socketWith({}, { authorization: `Bearer ${token}` }));
    expect(result).toEqual({ userId: 'user-A', organizationId: 'org-1' });
  });

  it('returns null organizationId when the token has no org (pre-org session)', async () => {
    const token = sign({ sub: 'user-A' });
    const result = await svc.authenticate(socketWith({ token }));
    expect(result).toEqual({ userId: 'user-A', organizationId: null });
  });

  // ─── Rejections: tampered / expired / wrong-type / gone user ───────────────

  it('rejects a tampered token (bad signature)', async () => {
    const token = sign({ sub: 'user-A', organizationId: 'org-1' });
    const tampered = token.slice(0, -3) + 'zzz';
    expect(await svc.authenticate(socketWith({ token: tampered }))).toBeNull();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ sub: 'user-A', organizationId: 'org-1' }, { secret: 'not-the-secret' });
    expect(await svc.authenticate(socketWith({ token: forged }))).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = sign({ sub: 'user-A', organizationId: 'org-1' }, { expiresIn: -10 });
    expect(await svc.authenticate(socketWith({ token }))).toBeNull();
  });

  it('rejects an org-selection token (pre-org, not a session credential)', async () => {
    const token = sign({ sub: 'user-A', type: 'org_selection' });
    expect(await svc.authenticate(socketWith({ token }))).toBeNull();
  });

  it('rejects a valid token whose user no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const token = sign({ sub: 'ghost', organizationId: 'org-1' });
    expect(await svc.authenticate(socketWith({ token }))).toBeNull();
  });

  it('rejects a valid token whose user has been deactivated', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-A', is_active: false });
    const token = sign({ sub: 'user-A', organizationId: 'org-1' });
    expect(await svc.authenticate(socketWith({ token }))).toBeNull();
  });

  it('rejects a valid token whose ORGANIZATION has been deactivated', async () => {
    prisma.organization.findUnique.mockResolvedValue({ status: 'inactive' });
    const token = sign({ sub: 'user-A', organizationId: 'org-1' });
    expect(await svc.authenticate(socketWith({ token }))).toBeNull();
  });

  it('still admits a super admin into a deactivated organization', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-A', is_active: true, is_super_admin: true });
    prisma.organization.findUnique.mockResolvedValue({ status: 'inactive' });
    const token = sign({ sub: 'user-A', organizationId: 'org-1' });
    expect(await svc.authenticate(socketWith({ token }))).toEqual({
      userId: 'user-A',
      organizationId: 'org-1',
    });
  });
});
