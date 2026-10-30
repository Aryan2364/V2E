/**
 * "Every person must keep at least one login handle" (point 1) and "an admin must
 * keep an email" (point 2), enforced on the user-update path. Proven against a
 * shared in-memory store, with AuthService for the "email-only user still logs in".
 */
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';

const HASH = bcrypt.hashSync('secret123', 4);

function makeWorld(users: any[], memberships: any[]) {
  const store = users.map((u) => ({ ...u }));
  const mem = memberships.map((m) => ({ ...m }));
  const findU = (pred: (u: any) => boolean) => store.find(pred) ?? null;

  const prisma: any = {
    // Logging in opens a per-device session (auth.service issueFullTokens).
    userSession: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })), create: jest.fn(() => Promise.resolve({})) },
    user: {
      findUnique: jest.fn(({ where }: any) => {
        let u: any = null;
        if (where.id !== undefined) u = findU((x) => x.id === where.id);
        else if (where.email !== undefined) u = findU((x) => x.email === where.email);
        else if (where.country_code_phone) {
          const { country_code, phone } = where.country_code_phone;
          u = findU((x) => x.country_code === country_code && x.phone === phone);
        }
        return Promise.resolve(u ? { ...u } : null);
      }),
      update: jest.fn(({ where, data }: any) => {
        const u = findU((x) => x.id === where.id);
        if (u) Object.assign(u, data);
        return Promise.resolve({ ...u });
      }),
    },
    organizationMember: {
      findFirst: jest.fn(({ where, include }: any) => {
        // "admin in any OTHER org" probe
        if (where.organization_id && typeof where.organization_id === 'object' && 'not' in where.organization_id) {
          const m = mem.find(
            (x) => x.user_id === where.user_id && x.is_admin === true && x.is_active === true && x.organization_id !== where.organization_id.not,
          );
          return Promise.resolve(m ? { id: 'm' } : null);
        }
        // findOne(): membership in this org (+ user)
        const m = mem.find((x) => x.user_id === where.user_id && x.organization_id === where.organization_id);
        if (!m) return Promise.resolve(null);
        const u = findU((x) => x.id === m.user_id);
        return Promise.resolve(include?.user ? { id: 'm-' + m.user_id, ...m, user: { ...u } } : { ...m });
      }),
      findMany: jest.fn(({ where }: any) => {
        const u = findU((x) => x.id === where.user_id);
        return Promise.resolve(u ? [{ organization_id: 'org-1', is_admin: true, joined_at: new Date(), organization: { id: 'org-1', name: 'Acme', slug: 'acme', logo_url: null } }] : []);
      }),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    organization: { findUnique: jest.fn(() => Promise.resolve({ is_test: false })) },
    employeeProfile: { findFirst: jest.fn(() => Promise.resolve(null)) },
  };
  const jwt: any = { sign: jest.fn(() => 'x') };
  const config: any = { get: jest.fn(() => 'x') };
  return { users: new UsersService(prisma), auth: new AuthService(prisma, jwt, config), store };
}

const bothHandles = (over: any = {}) => ({ id: 'u', name: 'U', email: 'u@acme.com', country_code: '+91', phone: '9999999999', password_hash: HASH, is_active: true, is_super_admin: false, ...over });

describe('point 1 — at least one login handle', () => {
  it('clearing email is allowed while a phone remains', async () => {
    const { users, store } = makeWorld([bothHandles()], [{ user_id: 'u', organization_id: 'org-1', is_admin: false, is_active: true }]);
    await users.update('u', 'org-1', { email: '' } as any);
    expect(store[0].email).toBeNull();
    expect(store[0].phone).toBe('9999999999');
  });

  it('clearing phone is allowed while an email remains', async () => {
    const { users, store } = makeWorld([bothHandles()], [{ user_id: 'u', organization_id: 'org-1', is_admin: false, is_active: true }]);
    await users.update('u', 'org-1', { phone: '', country_code: '' } as any);
    expect(store[0].phone).toBeNull();
    expect(store[0].email).toBe('u@acme.com');
  });

  it('clearing BOTH is rejected and nothing is changed', async () => {
    const { users, store } = makeWorld([bothHandles()], [{ user_id: 'u', organization_id: 'org-1', is_admin: false, is_active: true }]);
    await expect(users.update('u', 'org-1', { email: '', phone: '', country_code: '' } as any)).rejects.toThrow(/at least an email or a phone/i);
    expect(store[0].email).toBe('u@acme.com');
    expect(store[0].phone).toBe('9999999999');
  });
});

describe('point 2 — an admin must keep an email', () => {
  it('blanking an existing admin email is rejected (even with a phone present)', async () => {
    const { users } = makeWorld([bothHandles({ id: 'a' })], [{ user_id: 'a', organization_id: 'org-1', is_admin: true, is_active: true }]);
    await expect(users.update('a', 'org-1', { email: '' } as any)).rejects.toThrow(/admin must always have an email/i);
  });

  it('promoting a phone-only person to admin is rejected', async () => {
    const { users } = makeWorld([bothHandles({ id: 'p', email: null, phone: '7777777777' })], [{ user_id: 'p', organization_id: 'org-1', is_admin: false, is_active: true }]);
    await expect(users.update('p', 'org-1', { is_admin: true } as any)).rejects.toThrow(/admin must always have an email/i);
  });

  it('a non-admin phone-only person can still be edited (no email required)', async () => {
    const { users, store } = makeWorld([bothHandles({ id: 'q', email: null, phone: '7777777777' })], [{ user_id: 'q', organization_id: 'org-1', is_admin: false, is_active: true }]);
    await users.update('q', 'org-1', { name: 'Renamed' } as any);
    expect(store[0].name).toBe('Renamed');
  });
});

describe('existing email-only users are unaffected', () => {
  it('still logs in by email', async () => {
    const { auth } = makeWorld([bothHandles({ id: 'leg', email: 'legacy@acme.com', country_code: null, phone: null })], [{ user_id: 'leg', organization_id: 'org-1', is_admin: false, is_active: true }]);
    const r: any = await auth.login({ identifier: 'legacy@acme.com', password: 'secret123' } as any);
    expect(r.user.id).toBe('leg');
  });
});
