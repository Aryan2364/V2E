/**
 * Sign-in rules for the workspace login and the admin portal, against the REAL
 * AuthService with an in-memory datastore.
 *
 * The security rule under test (auth.messages.ts): a failed sign-in never reveals
 * whether an account exists. Unknown account, wrong password and "not a super admin"
 * all get the same InvalidCredentialsException. Messages about the account's state
 * (deactivated, no organization) are only given once the password is proven right.
 */
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  AUTH_MESSAGES,
  InvalidCredentialsException,
  TIMING_EQUALISER_HASH,
} from './auth.messages';
import { ORG_DEACTIVATED_MESSAGE } from '../common/org-status.util';
import {
  PASSWORD,
  makeAuthPrisma,
  makeAuthService,
  makeMembership,
  makeUser,
} from '../../test/helpers/auth-test-data';

const ASHA = () => makeUser();
const login = (
  service: ReturnType<typeof makeAuthService>,
  identifier: string,
  password: string,
  country_code?: string,
) => service.login({ identifier, password, country_code });
const adminLogin = (
  service: ReturnType<typeof makeAuthService>,
  identifier: string,
  password: string,
) => service.adminLogin({ identifier, password });

/** Resolves to the exception a sign-in threw (fails the test if it succeeded). */
async function refusal(
  promise: Promise<unknown>,
): Promise<UnauthorizedException> {
  try {
    await promise;
  } catch (err) {
    return err as UnauthorizedException;
  }
  throw new Error('expected the sign-in to be refused');
}

describe('AuthService.login: refusals never reveal whether an account exists', () => {
  it('an unknown email gets the generic credentials message', async () => {
    const service = makeAuthService(makeAuthPrisma({ users: [ASHA()] }));
    const err = await refusal(login(service, 'nobody@acme.com', PASSWORD));
    expect(err).toBeInstanceOf(InvalidCredentialsException);
    expect(err.message).toBe(AUTH_MESSAGES.invalidCredentials);
  });

  it('an unknown mobile number gets the same generic message', async () => {
    const service = makeAuthService(makeAuthPrisma({ users: [ASHA()] }));
    const err = await refusal(login(service, '9000000001', PASSWORD, '+91'));
    expect(err).toBeInstanceOf(InvalidCredentialsException);
  });

  it('a real email with the wrong password gets the SAME generic message', async () => {
    const service = makeAuthService(makeAuthPrisma({ users: [ASHA()] }));
    const err = await refusal(
      login(service, 'asha@acme.com', 'wrong-password'),
    );
    expect(err).toBeInstanceOf(InvalidCredentialsException);
    expect(err.message).toBe(AUTH_MESSAGES.invalidCredentials);
  });

  it('a real mobile number with the wrong password gets the same generic message', async () => {
    const service = makeAuthService(makeAuthPrisma({ users: [ASHA()] }));
    const err = await refusal(
      login(service, '9876543210', 'wrong-password', '+91'),
    );
    expect(err).toBeInstanceOf(InvalidCredentialsException);
  });

  it('a short password is just a wrong password (no policy message)', async () => {
    const service = makeAuthService(makeAuthPrisma({ users: [ASHA()] }));
    const err = await refusal(login(service, 'asha@acme.com', 'abc'));
    expect(err).toBeInstanceOf(InvalidCredentialsException);
  });

  it('every credential refusal is a 401', async () => {
    const service = makeAuthService(makeAuthPrisma({ users: [ASHA()] }));
    const unknown = await refusal(login(service, 'nobody@acme.com', PASSWORD));
    const wrong = await refusal(
      login(service, 'asha@acme.com', 'wrong-password'),
    );
    expect(unknown.getStatus()).toBe(401);
    expect(wrong.getStatus()).toBe(401);
  });
});

describe('AuthService.login: deactivated accounts', () => {
  const deactivated = () => makeUser({ is_active: false });

  it('with the RIGHT password, says the account is deactivated', async () => {
    const service = makeAuthService(makeAuthPrisma({ users: [deactivated()] }));
    const err = await refusal(login(service, 'asha@acme.com', PASSWORD));
    expect(err).not.toBeInstanceOf(InvalidCredentialsException);
    expect(err.message).toBe(AUTH_MESSAGES.accountDeactivated);
  });

  it('with a WRONG password, gets the generic message (deactivation is not revealed)', async () => {
    const service = makeAuthService(makeAuthPrisma({ users: [deactivated()] }));
    const err = await refusal(
      login(service, 'asha@acme.com', 'wrong-password'),
    );
    expect(err).toBeInstanceOf(InvalidCredentialsException);
  });
});

describe('AuthService.login: organizations', () => {
  it('right password but no active membership: says so (only the owner can see this)', async () => {
    const service = makeAuthService(
      makeAuthPrisma({ users: [ASHA()], memberships: {} }),
    );
    const err = await refusal(login(service, 'asha@acme.com', PASSWORD));
    expect(err.message).toBe(AUTH_MESSAGES.noOrganization);
  });

  it('right password but the only organization is deactivated: says the firm is deactivated', async () => {
    const service = makeAuthService(
      makeAuthPrisma({
        users: [ASHA()],
        memberships: { 'u-asha': [makeMembership('org-1', 'inactive')] },
      }),
    );
    const err = await refusal(login(service, 'asha@acme.com', PASSWORD));
    expect(err.message).toBe(ORG_DEACTIVATED_MESSAGE);
  });

  it('one active organization: signs straight in to it', async () => {
    const service = makeAuthService(
      makeAuthPrisma({
        users: [ASHA()],
        memberships: { 'u-asha': [makeMembership('org-1')] },
      }),
    );
    const result: any = await login(service, 'asha@acme.com', PASSWORD);
    expect(result.access_token).toBeDefined();
    expect(result.refresh_token).toBeDefined();
    expect(result.user).toMatchObject({
      id: 'u-asha',
      organizationId: 'org-1',
      isSuperAdmin: false,
    });
  });

  it('several active organizations: asks the person to choose one', async () => {
    const service = makeAuthService(
      makeAuthPrisma({
        users: [ASHA()],
        memberships: {
          'u-asha': [makeMembership('org-1'), makeMembership('org-2')],
        },
      }),
    );
    const result: any = await login(service, 'asha@acme.com', PASSWORD);
    expect(result.requires_org_selection).toBe(true);
    expect(result.selection_token).toBeDefined();
    expect(result.organizations.map((o: any) => o.id)).toEqual([
      'org-1',
      'org-2',
    ]);
    expect(result.access_token).toBeUndefined();
  });

  it('a deactivated organization is left out of the choice', async () => {
    const service = makeAuthService(
      makeAuthPrisma({
        users: [ASHA()],
        memberships: {
          'u-asha': [
            makeMembership('org-1'),
            makeMembership('org-2', 'inactive'),
          ],
        },
      }),
    );
    const result: any = await login(service, 'asha@acme.com', PASSWORD);
    // Only one usable firm remains, so the person is signed straight in to it.
    expect(result.user.organizationId).toBe('org-1');
  });
});

describe('AuthService.adminLogin', () => {
  const superAdmin = (overrides = {}) =>
    makeUser({
      id: 'u-admin',
      email: 'admin@v2e.io',
      is_super_admin: true,
      ...overrides,
    });

  it('an active super admin with the right password signs in', async () => {
    const service = makeAuthService(makeAuthPrisma({ users: [superAdmin()] }));
    const result: any = await adminLogin(service, 'admin@v2e.io', PASSWORD);
    expect(result.access_token).toBeDefined();
    expect(result.user).toMatchObject({
      id: 'u-admin',
      isSuperAdmin: true,
      organizationId: null,
    });
  });

  it('an unknown email gets the generic message', async () => {
    const service = makeAuthService(makeAuthPrisma({ users: [superAdmin()] }));
    expect(
      await refusal(adminLogin(service, 'nobody@v2e.io', PASSWORD)),
    ).toBeInstanceOf(InvalidCredentialsException);
  });

  it('a super admin with the wrong password gets the generic message', async () => {
    const service = makeAuthService(makeAuthPrisma({ users: [superAdmin()] }));
    expect(
      await refusal(adminLogin(service, 'admin@v2e.io', 'wrong-password')),
    ).toBeInstanceOf(InvalidCredentialsException);
  });

  it('a normal user with the RIGHT password gets the generic message (does not confirm the password)', async () => {
    const service = makeAuthService(makeAuthPrisma({ users: [ASHA()] }));
    const err = await refusal(adminLogin(service, 'asha@acme.com', PASSWORD));
    expect(err).toBeInstanceOf(InvalidCredentialsException);
    expect(err.message).toBe(AUTH_MESSAGES.invalidCredentials);
  });

  it('a deactivated super admin with the RIGHT password is told their access was deactivated', async () => {
    const service = makeAuthService(
      makeAuthPrisma({ users: [superAdmin({ is_active: false })] }),
    );
    const err = await refusal(adminLogin(service, 'admin@v2e.io', PASSWORD));
    expect(err).not.toBeInstanceOf(InvalidCredentialsException);
    expect(err.message).toBe(AUTH_MESSAGES.superAdminDeactivated);
  });

  it('a deactivated super admin with a WRONG password gets the generic message', async () => {
    const service = makeAuthService(
      makeAuthPrisma({ users: [superAdmin({ is_active: false })] }),
    );
    expect(
      await refusal(adminLogin(service, 'admin@v2e.io', 'wrong-password')),
    ).toBeInstanceOf(InvalidCredentialsException);
  });
});

describe('equal response time for unknown accounts', () => {
  it('the stand-in hash is a real bcrypt hash at the production cost (12)', () => {
    expect(bcrypt.getRounds(TIMING_EQUALISER_HASH)).toBe(12);
  });

  it('an unknown account still runs a full-cost password check (no fast "not found" path)', async () => {
    const service = makeAuthService(makeAuthPrisma({ users: [ASHA()] }));
    const started = Date.now();
    await refusal(login(service, 'nobody@acme.com', PASSWORD));
    // A cost-12 bcrypt comparison takes well over 40 ms on any machine; skipping it
    // (the old behaviour) answers in about 1 ms.
    expect(Date.now() - started).toBeGreaterThan(40);
  });
});
