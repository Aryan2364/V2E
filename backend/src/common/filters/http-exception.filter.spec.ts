import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter';

/**
 * The filter rebuilds every error body, so anything a thrower attaches beyond
 * `message` only reaches the browser if the filter passes it through. It didn't,
 * which silently disarmed the delete-override UI: the message arrived, the
 * `code`/`blockers` it depended on did not.
 */
describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();
  const json = jest.fn();
  const host: any = {
    switchToHttp: () => ({
      getResponse: () => ({ status: () => ({ json }) }),
      getRequest: () => ({ method: 'DELETE', url: '/api/v1/org/o1/employees/e1' }),
    }),
  };

  beforeEach(() => jest.clearAllMocks());

  it('passes structured fields through alongside the message', () => {
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'DELETE_BLOCKED_BY_DEPENDENTS',
        message: "Can't delete yet — 2 people report to them.",
        blockers: { reports: [{ id: 'p1', name: 'Seema' }], departments: [] },
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Can't delete yet — 2 people report to them.",
        code: 'DELETE_BLOCKED_BY_DEPENDENTS',
        blockers: { reports: [{ id: 'p1', name: 'Seema' }], departments: [] },
      }),
    );
    // The envelope's own keys must not be polluted by the exception's scaffolding.
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBeUndefined();
    expect(body.error).toBeUndefined();
  });

  it('still handles a plain string exception', () => {
    filter.catch(new NotFoundException('Employee not found'), host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, data: null, message: 'Employee not found' }),
    );
  });
});
