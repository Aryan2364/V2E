/**
 * Notifications gateway handshake auth (SECURITY_AUDIT C4).
 *
 * BEFORE: `handleConnection` read `client.handshake.auth.userId` and joined
 * `user:{that id}` with no verification — any party could open a socket, claim a
 * victim's id, and receive that victim's live notifications.
 *
 * This test drives the REAL handshake middleware the gateway registers, backed by
 * the REAL WsAuthService + JwtService (only Prisma's user lookup is mocked), and
 * proves: a spoofed-userId / no-token handshake is refused and joins no room,
 * while a properly-signed token connects and joins the room named by the VERIFIED
 * token subject — never by the client-supplied id.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotificationsGateway } from './notifications.gateway';
import { WsAuthService } from '../auth/ws-auth.service';
import { PrismaService } from '../prisma/prisma.service';

const SECRET = 'test-ws-secret';

describe('NotificationsGateway handshake auth (SECURITY_AUDIT C4)', () => {
  let gateway: NotificationsGateway;
  let jwt: JwtService;
  let middleware: (socket: any, next: (err?: Error) => void) => Promise<void>;
  // The handshake also checks the token's firm is still active (deactivated firms
  // lose their sockets) — an active org here, so only the user lookup decides.
  const prisma = {
    user: { findUnique: jest.fn() },
    organization: { findUnique: jest.fn().mockResolvedValue({ status: 'active' }) },
  };

  const sign = (payload: object, opts: object = {}) =>
    jwt.sign(payload, { secret: SECRET, ...opts });

  const makeSocket = (auth: any, headers: any = {}) =>
    ({ handshake: { auth, headers }, data: {}, join: jest.fn(), disconnect: jest.fn() }) as any;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: SECRET })],
      providers: [
        NotificationsGateway,
        WsAuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) },
        },
      ],
    }).compile();

    gateway = moduleRef.get(NotificationsGateway);
    jwt = moduleRef.get(JwtService);

    // Capture the handshake middleware the gateway registers in afterInit.
    const fakeServer: any = { use: (fn: any) => (middleware = fn) };
    gateway.afterInit(fakeServer);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-A', is_active: true });
  });

  it('REFUSES a spoofed-userId handshake with no token, and joins no room (the C4 hole)', async () => {
    const socket = makeSocket({ userId: 'victim' });
    const next = jest.fn();

    await middleware(socket, next);

    // Connection refused at the handshake.
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(socket.data.userId).toBeUndefined();

    // Even if the connection somehow proceeded, no victim room is joined.
    gateway.handleConnection(socket);
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('ACCEPTS a validly-signed token and joins the room named by the VERIFIED subject', async () => {
    const token = sign({ sub: 'user-A', organizationId: 'org-1' });
    // Include a spoofed id in the same handshake to prove it is ignored.
    const socket = makeSocket({ token, userId: 'victim' });
    const next = jest.fn();

    await middleware(socket, next);

    expect(next).toHaveBeenCalledWith(); // no error → connection allowed
    expect(socket.data.userId).toBe('user-A');

    gateway.handleConnection(socket);
    expect(socket.join).toHaveBeenCalledWith('user:user-A');
    expect(socket.join).not.toHaveBeenCalledWith('user:victim');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('REFUSES a tampered token', async () => {
    const token = sign({ sub: 'user-A', organizationId: 'org-1' });
    const socket = makeSocket({ token: token.slice(0, -3) + 'zzz' });
    const next = jest.fn();

    await middleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(socket.data.userId).toBeUndefined();
  });
});
