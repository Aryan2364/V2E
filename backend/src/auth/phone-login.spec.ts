/**
 * Login-by-phone behaviour, exercising the REAL AuthService.login against a mock
 * datastore keyed on the (country_code, phone) PAIR — exactly how Prisma's
 * composite-unique lookup works. Proves the country-code-aware requirements.
 */
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

const HASH = bcrypt.hashSync('secret123', 4);

// Three accounts:
//  ASHA  — has email + (+91, 9876543210)
//  RASHA — different person with the SAME digits under +971
//  SOLO  — legacy email-only user (country_code + phone both null)
const ASHA = { id: 'asha', name: 'Asha', email: 'asha@acme.com', country_code: '+91', phone: '9876543210', password_hash: HASH, is_active: true, is_super_admin: false };
const RASHA = { id: 'rasha', name: 'Rasha', email: 'rasha@acme.com', country_code: '+971', phone: '9876543210', password_hash: HASH, is_active: true, is_super_admin: false };
const SOLO = { id: 'solo', name: 'Solo', email: 'solo@acme.com', country_code: null, phone: null, password_hash: HASH, is_active: true, is_super_admin: false };
const ALL = [ASHA, RASHA, SOLO];

function makeService() {
  const prisma: any = {
    user: {
      findUnique: jest.fn(({ where }: any) => {
        if (where.email !== undefined) return Promise.resolve(ALL.find((u) => u.email === where.email) ?? null);
        if (where.id !== undefined) return Promise.resolve(ALL.find((u) => u.id === where.id) ?? null);
        if (where.country_code_phone) {
          const { country_code, phone } = where.country_code_phone;
          return Promise.resolve(ALL.find((u) => u.country_code === country_code && u.phone === phone) ?? null);
        }
        return Promise.resolve(null);
      }),
      update: jest.fn(() => Promise.resolve({})),
    },
    organizationMember: {
      findMany: jest.fn(() => Promise.resolve([
        { organization_id: 'org-1', is_admin: true, joined_at: new Date(), organization: { id: 'org-1', name: 'Acme', slug: 'acme', logo_url: null } },
      ])),
    },
    userSession: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })), create: jest.fn(() => Promise.resolve({})) },
    organization: { findUnique: jest.fn(() => Promise.resolve({ is_test: false })) },
    employeeProfile: { findFirst: jest.fn(() => Promise.resolve(null)) },
  };
  const jwt: any = { sign: jest.fn(() => 'signed') };
  const config: any = { get: jest.fn(() => 'x') };
  return new AuthService(prisma, jwt, config);
}

async function loginId(identifier: string, country_code?: string) {
  const r: any = await makeService().login({ identifier, country_code, password: 'secret123' } as any);
  return r.user.id;
}

describe('phone login (country-code aware)', () => {
  it('same person: email and phone resolve to the SAME account', async () => {
    expect(await loginId('asha@acme.com')).toBe('asha');
    expect(await loginId('9876543210', '+91')).toBe('asha');
  });

  it('registered as +91 / 9876543210 logs in with the same pair', async () => {
    expect(await loginId('9876543210', '+91')).toBe('asha');
  });

  it('pasting "+91 9876543210" into the number box still logs in', async () => {
    expect(await loginId('+91 9876543210', '+91')).toBe('asha');
  });

  it('typing "09876543210" (leading trunk 0) still logs in', async () => {
    expect(await loginId('09876543210', '+91')).toBe('asha');
  });

  it('same digits under +91 and +971 are two DIFFERENT users', async () => {
    expect(await loginId('9876543210', '+91')).toBe('asha');
    expect(await loginId('9876543210', '+971')).toBe('rasha');
  });

  it('legacy email-only user (phone + country_code null) still logs in by email', async () => {
    expect(await loginId('solo@acme.com')).toBe('solo');
  });

  it('a phone with the wrong country selected does not match the other account', async () => {
    // Asha is +91; searching those digits under +44 finds nobody.
    await expect(
      makeService().login({ identifier: '9876543210', country_code: '+44', password: 'secret123' } as any),
    ).rejects.toThrow(/not found/i);
  });
});
