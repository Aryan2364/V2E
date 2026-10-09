/**
 * Chat gateway handshake auth (SECURITY_AUDIT C5).
 *
 * BEFORE: the gateway trusted a client-supplied `userId` in the handshake and a
 * client-supplied `orgId` in every message, so anyone could impersonate any user
 * and read/send/edit/delete their chat across orgs.
 *
 * This test drives the REAL handshake middleware + REAL WsAuthService/JwtService
 * (mocking only Prisma and the MessagingService boundary) and proves:
 *   - a spoofed / no-token handshake is refused and cannot send a message;
 *   - an authenticated socket acts as the VERIFIED user in the VERIFIED org — a
 *     malicious `orgId` in the message payload is ignored in favour of the token.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { MessagingService } from './messaging.service';
import { WsAuthService } from '../auth/ws-auth.service';
import { PrismaService } from '../prisma/prisma.service';

const SECRET = 'test-ws-secret';

describe('ChatGateway handshake auth (SECURITY_AUDIT C5)', () => {
  let gateway: ChatGateway;
  let jwt: JwtService;
  let middleware: (socket: any, next: (err?: Error) => void) => Promise<void>;

  // The handshake also checks the token's firm is still active (deactivated firms
  // lose their sockets) — an active org here, so only the user lookup decides.
  const prisma = {
    user: { findUnique: jest.fn() },
    organization: { findUnique: jest.fn().mockResolvedValue({ status: 'active' }) },
  };
  const messaging = {
    getConversation: jest.fn(),
    sendMessage: jest.fn(),
    editMessage: jest.fn(),
    deleteMessage: jest.fn(),
  };

  const sign = (payload: object, opts: object = {}) =>
    jwt.sign(payload, { secret: SECRET, ...opts });

  const makeSocket = (auth: any, headers: any = {}) =>
    ({
      handshake: { auth, headers },
      data: {},
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    }) as any;

  // Run a socket through the REAL handshake middleware so client.data is populated
  // exactly as it is in production.
  const connect = async (auth: any, headers: any = {}) => {
    const socket = makeSocket(auth, headers);
    const next = jest.fn();
    await middleware(socket, next);
    return { socket, next };
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: SECRET })],
      providers: [
        ChatGateway,
        WsAuthService,
        { provide: MessagingService, useValue: messaging },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) },
        },
      ],
    }).compile();

    gateway = moduleRef.get(ChatGateway);
    jwt = moduleRef.get(JwtService);
    (gateway as any).server = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) };

    const fakeServer: any = { use: (fn: any) => (middleware = fn) };
    gateway.afterInit(fakeServer);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-A', is_active: true });
    messaging.getConversation.mockResolvedValue({ id: 'c1' });
    messaging.sendMessage.mockResolvedValue({ id: 'm1', conversation_id: 'c1' });
  });

  // ─── The hole ──────────────────────────────────────────────────────────────

  it('REFUSES a spoofed-userId handshake with no token', async () => {
    const { socket, next } = await connect({ userId: 'victim', orgId: 'victim-org' });
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(socket.data.userId).toBeUndefined();
  });

  it('a spoofed (unauthenticated) socket cannot send a message', async () => {
    const { socket } = await connect({ userId: 'victim', orgId: 'victim-org' });
    const result = await gateway.handleSendMessage(socket, {
      convId: 'c1',
      dto: { body: 'hi' },
    } as any);
    expect(result).toBeUndefined();
    expect(messaging.sendMessage).not.toHaveBeenCalled();
  });

  // ─── The fix ─────────────────────────────────────────────────────────────────

  it('ACCEPTS a valid token and stamps the verified user + org on the socket', async () => {
    const token = sign({ sub: 'user-A', organizationId: 'org-1' });
    const { socket, next } = await connect({ token, userId: 'victim', orgId: 'evil-org' });
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.userId).toBe('user-A');
    expect(socket.data.organizationId).toBe('org-1');
  });

  it('sends as the VERIFIED user + org, ignoring a malicious orgId in the payload', async () => {
    const token = sign({ sub: 'user-A', organizationId: 'org-1' });
    const { socket } = await connect({ token });

    // Attacker stuffs a foreign orgId into the message payload.
    await gateway.handleSendMessage(socket, {
      convId: 'c1',
      orgId: 'evil-org',
      dto: { body: 'hi' },
    } as any);

    // The service is called with the token's org + user, NOT the payload's org.
    expect(messaging.sendMessage).toHaveBeenCalledWith('c1', 'user-A', 'org-1', { body: 'hi' });
  });

  it('joins a conversation as the verified user + org and gates on membership', async () => {
    const token = sign({ sub: 'user-A', organizationId: 'org-1' });
    const { socket } = await connect({ token });

    const ok = await gateway.handleJoin(socket, { convId: 'c1', orgId: 'evil-org' } as any);
    expect(messaging.getConversation).toHaveBeenCalledWith('c1', 'user-A', 'org-1');
    expect(ok).toEqual({ joined: 'c1' });
    expect(socket.join).toHaveBeenCalledWith('conv:c1');
  });

  it('refuses to join a conversation the verified user is not a member of', async () => {
    messaging.getConversation.mockRejectedValueOnce(new Error('not a member'));
    const token = sign({ sub: 'user-A', organizationId: 'org-1' });
    const { socket } = await connect({ token });

    const res = await gateway.handleJoin(socket, { convId: 'c1' } as any);
    expect(res).toEqual({ error: 'forbidden' });
    expect(socket.join).not.toHaveBeenCalled();
  });
});
