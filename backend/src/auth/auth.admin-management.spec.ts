/**
 * Super-admin management (the admin portal's "Admins" screen): list, create,
 * activate/deactivate, revoke and update super admins, against the REAL AuthService
 * with an in-memory datastore.
 *
 * The UI already hides "deactivate yourself" and disables "revoke" for yourself and
 * for the last admin; these checks are the backend safety net for direct API calls.
 */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  makeAuthPrisma,
  makeAuthService,
  makeUser,
} from '../../test/helpers/auth-test-data';

const admin = (id: string, overrides = {}) =>
  makeUser({
    id,
    email: `${id}@v2e.io`,
    phone: null,
    is_super_admin: true,
    ...overrides,
  });

function setup(users = [admin('a1'), admin('a2'), makeUser()]) {
  const prisma = makeAuthPrisma({ users });
  return { prisma, service: makeAuthService(prisma), users: prisma.users };
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the call to be refused');
}

describe('listAdmins', () => {
  it('lists only super admins, never normal users', async () => {
    const { service } = setup();
    const admins = await service.listAdmins();
    expect(admins.map((a: any) => a.id).sort()).toEqual(['a1', 'a2']);
  });
});

describe('createAdmin', () => {
  it('creates a new super admin with a hashed password', async () => {
    const { service, users } = setup();
    await service.createAdmin({
      name: 'New',
      email: 'new@v2e.io',
      password: 'strong-pass-1',
    });
    const created = users.find((u: any) => u.email === 'new@v2e.io')!;
    expect(created.is_super_admin).toBe(true);
    expect(created.password_hash).not.toBe('strong-pass-1');
    expect(await bcrypt.compare('strong-pass-1', created.password_hash)).toBe(
      true,
    );
  });

  it('promotes an existing normal user instead of creating a duplicate account', async () => {
    const { service, users } = setup();
    const before = users.length;
    await service.createAdmin({
      name: 'Asha',
      email: 'asha@acme.com',
      password: 'ignored-pass',
    });
    expect(users).toHaveLength(before);
    expect(
      users.find((u: any) => u.email === 'asha@acme.com')!.is_super_admin,
    ).toBe(true);
  });

  it('refuses an email that is already a super admin', async () => {
    const { service } = setup();
    const err = await refusal(
      service.createAdmin({
        name: 'Dup',
        email: 'a1@v2e.io',
        password: 'x-pass-123',
      }),
    );
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('This email is already a super administrator.');
  });
});

describe('toggleAdmin (activate / deactivate)', () => {
  it('deactivates another super admin', async () => {
    const { service, users } = setup();
    await service.toggleAdmin('a2', 'a1', false);
    expect(users.find((u: any) => u.id === 'a2')!.is_active).toBe(false);
  });

  it('reactivates a deactivated super admin', async () => {
    const { service, users } = setup([
      admin('a1'),
      admin('a2', { is_active: false }),
    ]);
    await service.toggleAdmin('a2', 'a1', true);
    expect(users.find((u: any) => u.id === 'a2')!.is_active).toBe(true);
  });

  it('refuses to let an admin deactivate their own account', async () => {
    const { service, users } = setup();
    const err = await refusal(service.toggleAdmin('a1', 'a1', false));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe('You cannot deactivate your own account.');
    expect(users.find((u: any) => u.id === 'a1')!.is_active).toBe(true);
  });

  it('cannot be used to deactivate a normal (non-admin) user', async () => {
    const { service, users } = setup();
    await refusal(service.toggleAdmin('u-asha', 'a1', false));
    expect(users.find((u: any) => u.id === 'u-asha')!.is_active).toBe(true);
  });
});

describe('revokeAdmin', () => {
  it('removes super-admin access from another admin', async () => {
    const { service, users } = setup();
    await service.revokeAdmin('a2', 'a1');
    expect(users.find((u: any) => u.id === 'a2')!.is_super_admin).toBe(false);
  });

  it('refuses to let an admin revoke their own access', async () => {
    const { service, users } = setup();
    const err = await refusal(service.revokeAdmin('a1', 'a1'));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe('You cannot revoke your own super admin access.');
    expect(users.find((u: any) => u.id === 'a1')!.is_super_admin).toBe(true);
  });

  it('refuses to remove the last super admin', async () => {
    // Only one super admin exists; a direct API call naming them (as someone else)
    // must still be refused so the platform never ends up with no admin at all.
    const { service, users } = setup([admin('a1'), makeUser()]);
    const err = await refusal(service.revokeAdmin('a1', 'someone-else'));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe(
      'At least one super administrator account is required at all times.',
    );
    expect(users.find((u: any) => u.id === 'a1')!.is_super_admin).toBe(true);
  });

  it('cannot be used on a normal (non-admin) user', async () => {
    const { service } = setup();
    await refusal(service.revokeAdmin('u-asha', 'a1'));
  });
});

describe('updateAdmin', () => {
  it('updates name, email and password', async () => {
    const { service, users } = setup();
    await service.updateAdmin('a2', {
      name: '  Renamed ',
      email: ' renamed@v2e.io ',
      password: 'new-pass-123',
    });
    const updated = users.find((u: any) => u.id === 'a2')!;
    expect(updated.name).toBe('Renamed');
    expect(updated.email).toBe('renamed@v2e.io');
    expect(await bcrypt.compare('new-pass-123', updated.password_hash)).toBe(
      true,
    );
  });

  it('requires both an email and a password', async () => {
    const { service } = setup();
    const err = await refusal(
      service.updateAdmin('a2', { email: '', password: '' }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(
      'Email address and password are required to save changes.',
    );
  });

  it('refuses an email already used by another account', async () => {
    const { service } = setup();
    const err = await refusal(
      service.updateAdmin('a2', {
        email: 'asha@acme.com',
        password: 'new-pass-123',
      }),
    );
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('This email is already taken.');
  });

  it('keeping the same email is allowed', async () => {
    const { service } = setup();
    await expect(
      service.updateAdmin('a2', {
        email: 'a2@v2e.io',
        password: 'new-pass-123',
      }),
    ).resolves.toBeDefined();
  });

  it('refuses an id that is not a super admin', async () => {
    const { service } = setup();
    const err = await refusal(
      service.updateAdmin('u-asha', {
        email: 'x@v2e.io',
        password: 'new-pass-123',
      }),
    );
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toBe('Admin user not found.');
  });
});
