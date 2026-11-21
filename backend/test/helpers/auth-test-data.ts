/**
 * Shared test data for the authentication specs: a few users, and an in-memory
 * stand-in for the Prisma calls that sign-in, admin sign-in and password reset make.
 *
 * Lives in backend/test (excluded from the production build), not in src.
 */
import * as bcrypt from 'bcryptjs';
import { AuthService } from '../../src/auth/auth.service';

export const PASSWORD = 'secret123';
/** Cost 4 keeps the suite fast; production hashes use 12. */
export const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

export interface TestUser {
  id: string;
  name: string;
  email: string | null;
  country_code: string | null;
  phone: string | null;
  password_hash: string;
  is_active: boolean;
  is_super_admin: boolean;
  [key: string]: unknown;
}

export function makeUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: 'u-asha',
    name: 'Asha',
    email: 'asha@acme.com',
    country_code: '+91',
    phone: '9876543210',
    password_hash: PASSWORD_HASH,
    is_active: true,
    is_super_admin: false,
    ...overrides,
  };
}

export function makeMembership(
  orgId: string,
  status: 'active' | 'inactive' = 'active',
) {
  return {
    organization_id: orgId,
    is_admin: false,
    joined_at: new Date('2026-01-01'),
    organization: {
      id: orgId,
      name: `Org ${orgId}`,
      slug: orgId,
      logo_url: null,
      status,
    },
  };
}

/** A password-reset row as the in-memory store keeps it. */
export interface ResetRow {
  id: string;
  email: string;
  otp_hash: string;
  expires_at: Date;
  created_at: Date;
  attempts: number;
  reset_token: string | null;
  consumed_at: Date | null;
}

/** Does a row satisfy a Prisma-style `where`? Supports equality, { not }, { lte }. */
export function matches(
  row: Record<string, any>,
  where: Record<string, any>,
): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('not' in value) return row[key] !== value.not;
      if ('lte' in value) return row[key] <= value.lte;
    }
    return row[key] === value;
  });
}

/**
 * An in-memory Prisma for the auth tests. `memberships` maps a user id to that
 * user's active memberships. Every method is a jest.fn, so tests can assert calls.
 */
export function makeAuthPrisma(
  opts: { users?: TestUser[]; memberships?: Record<string, unknown[]> } = {},
) {
  const users = opts.users ?? [makeUser()];
  const memberships = opts.memberships ?? {};
  const resets: ResetRow[] = [];
  const sessions: Array<Record<string, unknown>> = [];
  let resetSeq = 0;

  const findUser = (where: any): TestUser | null => {
    if (where.country_code_phone) {
      const { country_code, phone } = where.country_code_phone;
      return (
        users.find(
          (u) => u.country_code === country_code && u.phone === phone,
        ) ?? null
      );
    }
    return users.find((u) => matches(u, where)) ?? null;
  };
  const membershipsOf = (userId: string): any[] =>
    (memberships[userId] ?? []) as any[];
  /** Prisma throws P2025 when update() matches no row. */
  const notFound = () =>
    Object.assign(new Error('Record to update not found.'), { code: 'P2025' });

  const prisma: any = {
    users,
    resets,
    sessions,
    user: {
      findUnique: jest.fn(async ({ where }: any) => findUser(where)),
      findFirst: jest.fn(async ({ where }: any) => findUser(where)),
      findMany: jest.fn(async ({ where }: any = {}) =>
        users.filter((u) => matches(u, where ?? {})),
      ),
      count: jest.fn(
        async ({ where }: any = {}) =>
          users.filter((u) => matches(u, where ?? {})).length,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const user = findUser(where);
        if (!user) throw notFound();
        Object.assign(user, data);
        return user;
      }),
      create: jest.fn(async ({ data }: any) => {
        const user = makeUser({ id: `u-${users.length + 1}`, ...data });
        users.push(user);
        return user;
      }),
    },
    organizationMember: {
      findMany: jest.fn(async ({ where }: any) => membershipsOf(where.user_id)),
      findFirst: jest.fn(async ({ where }: any) => {
        const m = membershipsOf(where.user_id).find(
          (x) => x.organization_id === where.organization_id,
        );
        return m ? { ...m, is_active: true } : null;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const key = where.organization_id_user_id;
        const m = membershipsOf(key.user_id).find(
          (x) => x.organization_id === key.organization_id,
        );
        return m ? { is_admin: m.is_admin, is_active: true } : null;
      }),
      create: jest.fn(),
    },
    organization: { findUnique: jest.fn(async () => ({ is_test: false })) },
    employeeProfile: { findFirst: jest.fn(async () => null) },
    userSession: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          sessions.find((x) => x.id === where.id) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        sessions.push({
          current_confirmed: false,
          prev_token_hash: null,
          ...data,
        });
        return data;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = sessions.filter((x) => matches(x, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const doomed = sessions.filter((x) => matches(x, where));
        doomed.forEach((d) => sessions.splice(sessions.indexOf(d), 1));
        return { count: doomed.length };
      }),
    },
    passwordReset: {
      findFirst: jest.fn(async ({ where }: any) => {
        const matching = resets.filter(
          (r) =>
            r.email === where.email &&
            r.consumed_at === null &&
            (where.reset_token === undefined ||
              r.reset_token === where.reset_token),
        );
        return (
          matching.sort(
            (a, b) => b.created_at.getTime() - a.created_at.getTime(),
          )[0] ?? null
        );
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = resets.length;
        for (let i = resets.length - 1; i >= 0; i--)
          if (resets[i].email === where.email) resets.splice(i, 1);
        return { count: before - resets.length };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: ResetRow = {
          id: `pr-${++resetSeq}`,
          attempts: 0,
          reset_token: null,
          consumed_at: null,
          created_at: new Date(),
          ...data,
        };
        resets.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = resets.find((r) => r.id === where.id);
        if (!row) return null;
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && 'increment' in value) {
            (row as any)[key] += (value as { increment: number }).increment;
          } else {
            (row as any)[key] = value;
          }
        }
        return row;
      }),
    },
  };
  return prisma;
}

/** JWT and config stand-ins: tokens are opaque strings, secrets are fixed. */
export function makeJwtMock() {
  return {
    sign: jest.fn(() => 'signed-token'),
    decode: jest.fn(() => ({ exp: Math.floor(Date.now() / 1000) + 3600 })),
    verify: jest.fn(),
  };
}

/** Fixed test secrets; the access and refresh secrets differ, as in production. */
export const TEST_CONFIG: Record<string, string> = {
  JWT_SECRET: 'test-access-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '30d',
};

export function makeConfigMock() {
  return { get: jest.fn((key: string) => TEST_CONFIG[key] ?? 'test-value') };
}

export function makeAuthService(prisma = makeAuthPrisma()) {
  return new AuthService(prisma, makeJwtMock() as any, makeConfigMock() as any);
}
