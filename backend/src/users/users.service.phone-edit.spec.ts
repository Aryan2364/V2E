/**
 * Editing phone on an EXISTING account (audit issue #4), proven end-to-end against
 * a shared in-memory user store: UsersService.update writes the phone, and the real
 * AuthService.login then finds (or no longer finds) the user by the (country_code,
 * phone) pair. Also covers clearing, and the cross-account collision guard.
 */
import { ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';

const HASH = bcrypt.hashSync('secret123', 4);

function makeWorld(initial: any[]) {
  const store = initial.map((u) => ({ ...u }));
  const find = (pred: (u: any) => boolean) => store.find(pred) ?? null;

  const prisma: any = {
    // Logging in opens a per-device session (auth.service issueFullTokens).
    userSession: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })), create: jest.fn(() => Promise.resolve({})) },
    user: {
      findUnique: jest.fn(({ where }: any) => {
        let u: any = null;
        if (where.id !== undefined) u = find((x) => x.id === where.id);
        else if (where.email !== undefined) u = find((x) => x.email === where.email);
        else if (where.country_code_phone) {
          const { country_code, phone } = where.country_code_phone;
          u = find((x) => x.country_code === country_code && x.phone === phone);
        }
        return Promise.resolve(u ? { ...u } : null);
      }),
      update: jest.fn(({ where, data }: any) => {
        const u = find((x) => x.id === where.id);
        if (u) Object.assign(u, data);
        return Promise.resolve({ ...u });
      }),
    },
    organizationMember: {
      findFirst: jest.fn(({ where, include }: any) => {
        const u = find((x) => x.id === where.user_id);
        if (!u) return Promise.resolve(null);
        const m = { id: 'm-' + u.id, user_id: u.id, organization_id: where.organization_id ?? 'org-1', is_admin: true, is_active: true };
        return Promise.resolve(include?.user ? { ...m, user: { ...u } } : m);
      }),
      findMany: jest.fn(({ where }: any) => {
        const u = find((x) => x.id === where.user_id);
        return Promise.resolve(
          u ? [{ organization_id: 'org-1', is_admin: true, joined_at: new Date(), organization: { id: 'org-1', name: 'Acme', slug: 'acme', logo_url: null } }] : [],
        );
      }),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    organization: { findUnique: jest.fn(() => Promise.resolve({ is_test: false })) },
    employeeProfile: { findFirst: jest.fn(() => Promise.resolve(null)) },
  };
  const jwt: any = { sign: jest.fn(() => 'signed') };
  const config: any = { get: jest.fn(() => 'x') };
  return { users: new UsersService(prisma), auth: new AuthService(prisma, jwt, config), store };
}

async function loginId(auth: AuthService, identifier: string, country_code?: string) {
  const r: any = await auth.login({ identifier, country_code, password: 'secret123' } as any);
  return r.user.id;
}

describe('edit phone on an existing account', () => {
  it('adds a phone to an email-only user, then changes it, then clears it', async () => {
    const { users, auth } = makeWorld([
      { id: 'u1', name: 'Solo', email: 'solo@acme.com', country_code: null, phone: null, password_hash: HASH, is_active: true, is_super_admin: false },
    ]);

    // Add a phone → the user can now log in by it.
    await users.update('u1', 'org-1', { phone: '9876543210', country_code: '+91' } as any);
    expect(await loginId(auth, '9876543210', '+91')).toBe('u1');
    expect(await loginId(auth, 'solo@acme.com')).toBe('u1');

    // Change the phone → the OLD number stops working, the NEW one works.
    await users.update('u1', 'org-1', { phone: '8887776666', country_code: '+91' } as any);
    expect(await loginId(auth, '8887776666', '+91')).toBe('u1');
    await expect(loginId(auth, '9876543210', '+91')).rejects.toThrow(/not found/i);

    // Clear the phone → email still logs in; the number no longer does.
    await users.update('u1', 'org-1', { phone: '', country_code: '' } as any);
    expect(await loginId(auth, 'solo@acme.com')).toBe('u1');
    await expect(loginId(auth, '8887776666', '+91')).rejects.toThrow(/not found/i);
  });

  it('rejects a number already used by another account, changing neither account', async () => {
    const { users, store } = makeWorld([
      { id: 'a', name: 'Asha', email: 'asha@acme.com', country_code: '+91', phone: '9876543210', password_hash: HASH, is_active: true, is_super_admin: false },
      { id: 'b', name: 'Ben', email: 'ben@acme.com', country_code: null, phone: null, password_hash: HASH, is_active: true, is_super_admin: false },
    ]);

    await expect(
      users.update('b', 'org-1', { phone: '9876543210', country_code: '+91' } as any),
    ).rejects.toThrow(ConflictException);

    // Neither account was modified.
    expect(store.find((u) => u.id === 'a')!.phone).toBe('9876543210');
    expect(store.find((u) => u.id === 'b')!.phone).toBeNull();
  });

  it('a 5-digit number is rejected by the API on the edit path', async () => {
    const { users } = makeWorld([
      { id: 'u1', name: 'Solo', email: 'solo@acme.com', country_code: null, phone: null, password_hash: HASH, is_active: true, is_super_admin: false },
    ]);
    await expect(users.update('u1', 'org-1', { phone: '12345', country_code: '+91' } as any)).rejects.toThrow(/10 digit number for India/i);
  });

  it('a legacy email-only user keeps logging in by email (untouched)', async () => {
    const { auth } = makeWorld([
      { id: 'leg', name: 'Legacy', email: 'legacy@acme.com', country_code: null, phone: null, password_hash: HASH, is_active: true, is_super_admin: false },
    ]);
    expect(await loginId(auth, 'legacy@acme.com')).toBe('leg');
  });
});
