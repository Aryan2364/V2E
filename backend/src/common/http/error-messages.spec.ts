/**
 * The default user-facing sentence per HTTP status, and how GlobalExceptionFilter
 * applies it: framework stock text is replaced, a developer's own message is kept,
 * database internals never reach the user.
 */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_ERROR_MESSAGES, defaultErrorMessage, isStockMessage } from './error-messages';
import { GlobalExceptionFilter } from '../filters/http-exception.filter';

describe('defaultErrorMessage', () => {
  it.each([400, 401, 403, 404, 409, 429, 500, 503])('has a sentence for %i', (status) => {
    expect(defaultErrorMessage(status)).toBe(DEFAULT_ERROR_MESSAGES[status]);
  });

  it('an unlisted 4xx falls back to the 400 sentence', () => {
    expect(defaultErrorMessage(418)).toBe(DEFAULT_ERROR_MESSAGES[400]);
  });

  it('an unlisted 5xx falls back to the 500 sentence', () => {
    expect(defaultErrorMessage(599)).toBe(DEFAULT_ERROR_MESSAGES[500]);
  });

  it('every sentence follows the writing rules: no "Error:" prefix, no exclamation mark, ends with a full stop', () => {
    for (const sentence of Object.values(DEFAULT_ERROR_MESSAGES)) {
      expect(sentence).not.toMatch(/^error/i);
      expect(sentence).not.toContain('!');
      expect(sentence.endsWith('.')).toBe(true);
    }
  });
});

describe('isStockMessage', () => {
  it.each([
    ['Forbidden', 403],
    ['Unauthorized', 401],
    ['Not Found', 404],
    ['Forbidden resource', 403],
    ['Internal server error', 500],
    ['Cannot GET /api/v1/nope', 404],
    ['ThrottlerException: Too Many Requests', 429],
    ['', 400],
  ])('"%s" (%i) is stock text', (message, status) => {
    expect(isStockMessage(message, status)).toBe(true);
  });

  it('a missing message counts as stock', () => {
    expect(isStockMessage(undefined, 400)).toBe(true);
  });

  it.each([
    ['Employee not found in this organization', 404],
    ['You cannot revoke your own super admin access.', 403],
    ['Too many attempts. Please wait 15 minutes and try again.', 429],
  ])('"%s" is a developer\'s own message and is kept', (message, status) => {
    expect(isStockMessage(message, status)).toBe(false);
  });

  it('a list of validation messages is never stock', () => {
    expect(isStockMessage(['Enter your password.'], 400)).toBe(false);
  });
});

describe('GlobalExceptionFilter: what the user is sent', () => {
  const filter = new GlobalExceptionFilter();
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host: any = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', url: '/api/v1/test' }),
    }),
  };
  const sent = () => json.mock.calls.at(-1)![0];
  const sentStatus = () => (status.mock.calls.at(-1) as unknown as [number])[0];

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());
  beforeEach(() => jest.clearAllMocks());

  it('a bare 401 gets the plain session sentence instead of "Unauthorized"', () => {
    filter.catch(new UnauthorizedException(), host);
    expect(sent().message).toBe(DEFAULT_ERROR_MESSAGES[401]);
  });

  it('a guard refusal ("Forbidden resource") gets the plain 403 sentence', () => {
    filter.catch(new ForbiddenException('Forbidden resource'), host);
    expect(sent().message).toBe(DEFAULT_ERROR_MESSAGES[403]);
  });

  it('an unknown route ("Cannot POST /x") gets the plain 404 sentence', () => {
    filter.catch(new NotFoundException('Cannot POST /api/v1/nope'), host);
    expect(sent().message).toBe(DEFAULT_ERROR_MESSAGES[404]);
  });

  it("a developer's own message is sent unchanged", () => {
    filter.catch(new NotFoundException('Task not found'), host);
    expect(sent().message).toBe('Task not found');
  });

  it('an unexpected crash gets the plain 500 sentence, never the error text', () => {
    filter.catch(new Error('connect ECONNREFUSED 10.0.0.5:5432'), host);
    expect(sentStatus()).toBe(500);
    expect(sent().message).toBe(DEFAULT_ERROR_MESSAGES[500]);
  });

  it('a stock 500 exception also gets the plain sentence', () => {
    filter.catch(new InternalServerErrorException(), host);
    expect(sent().message).toBe(DEFAULT_ERROR_MESSAGES[500]);
  });

  it('several validation messages become one paragraph of full sentences', () => {
    filter.catch(new BadRequestException(['Enter your email address or mobile number.', 'Enter your password']), host);
    expect(sent().message).toBe('Enter your email address or mobile number. Enter your password.');
  });

  it('a duplicate value (P2002) is a friendly 409 that does not name the column', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['email'] },
    });
    filter.catch(err, host);
    expect(sentStatus()).toBe(409);
    expect(sent().message).toBe('This already exists. Use a different value and try again.');
    expect(sent().message).not.toContain('email');
  });

  it('a broken reference (P2003) is a friendly 400 that does not name the column', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Foreign key failed', {
      code: 'P2003',
      clientVersion: 'test',
      meta: { field_name: 'department_id' },
    });
    filter.catch(err, host);
    expect(sentStatus()).toBe(400);
    expect(sent().message).not.toContain('department_id');
  });

  it('a missing record (P2025) is the plain 404 sentence', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Record to update not found', {
      code: 'P2025',
      clientVersion: 'test',
    });
    filter.catch(err, host);
    expect(sentStatus()).toBe(404);
    expect(sent().message).toBe(DEFAULT_ERROR_MESSAGES[404]);
  });

  it('a 429 from the rate limiter keeps its own wait-time message', () => {
    filter.catch(new HttpException('Too many attempts. Please wait 15 minutes and try again.', 429), host);
    expect(sent().message).toBe('Too many attempts. Please wait 15 minutes and try again.');
  });
});
