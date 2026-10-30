/**
 * Public-registration privilege-escalation regression test (SECURITY_AUDIT C1).
 *
 * The public `POST /api/v1/auth/register` route accepted `organization_id` and
 * `is_admin` in the request body and, if present, wrote an OrganizationMember
 * row with that admin flag into that org. A stranger who knew a victim org's id
 * could therefore self-register straight into it as a platform admin.
 *
 * This test exercises the REAL request pipeline: the real AuthController, the
 * real AuthService, and — crucially — the SAME global ValidationPipe as
 * production (`main.ts`: whitelist + transform). Only the datastore boundary is
 * mocked (Prisma / Jwt / Config), so the assertion "no membership row was ever
 * created" is a genuine statement about what the service tried to write.
 *
 * The fix has two layers and this test covers both:
 *   - DTO layer: `is_admin` / `organization_id` are no longer declared on
 *     RegisterDto, so `whitelist: true` strips them before the service runs;
 *   - service layer: the self-attach block is gone, so even a field that slipped
 *     through could not mint a membership.
 *
 * Case 1 is the one that FAILS on the unpatched code (the malicious body reaches
 * the service and `organizationMember.create` is called with is_admin:true).
 * Case 2 is the positive control: plain account-only registration must still
 * create the user and — with no org supplied — no membership.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { GoogleAccountService } from '../gcal/google-account.service';
import { PrismaService } from '../prisma/prisma.service';

describe('POST /auth/register cross-org self-join (SECURITY_AUDIT C1)', () => {
  let app: INestApplication;

  // Datastore boundary — the only thing mocked. organizationMember.create is the
  // dangerous side effect the test watches.
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'new-user',
        name: 'New User',
        email: 'new@user.example',
        is_active: true,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    userSession: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })), create: jest.fn(() => Promise.resolve({})) },
    organizationMember: {
      create: jest.fn().mockResolvedValue({ id: 'member-1' }),
    },
  };

  const jwt = { sign: jest.fn().mockReturnValue('signed-token') };
  const config = { get: jest.fn().mockReturnValue('test-value') };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
        // The controller depends on these too; the register route under test never
        // calls them, so empty stubs are enough to satisfy DI.
        { provide: PasswordResetService, useValue: {} },
        { provide: GoogleAccountService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror production exactly (main.ts) — this is what strips the removed
    // fields from the request body.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('does NOT create an org membership when a stranger posts organization_id + is_admin', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Mallory',
        email: 'mallory@attacker.example',
        password: 'password123',
        organization_id: 'victim-org',
        is_admin: true,
      })
      .expect(201);

    // The whole hole in one assertion: registration may create the personal
    // account, but it must NEVER attach the caller to an org — least of all as
    // an admin. On the unpatched code this fails (create called with is_admin).
    expect(prisma.organizationMember.create).not.toHaveBeenCalled();
  });

  it('still registers a plain account-only user (creates the user, no membership)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Alice',
        email: 'alice@company.example',
        password: 'password123',
      })
      .expect(201);

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'alice@company.example' }),
      }),
    );
    expect(prisma.organizationMember.create).not.toHaveBeenCalled();
  });
});
