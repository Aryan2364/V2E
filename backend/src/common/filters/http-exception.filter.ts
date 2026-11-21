import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { defaultErrorMessage, isStockMessage } from '../http/error-messages';

/**
 * Several validation messages as one readable paragraph: each ends with a full stop
 * and they are separated by a space ("Enter your email. Enter your password."),
 * not run together with commas.
 */
function asSentences(messages: unknown[]): string {
  return messages
    .filter((m): m is string => typeof m === 'string' && !!m.trim())
    .map((m) => {
      const s = m.trim();
      return /[.!?]$/.test(s) ? s : `${s}.`;
    })
    .join(' ');
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    // Anything a thrower attached to the exception body beyond the standard
    // statusCode/error/message — e.g. a machine-readable `code` plus the records
    // behind a refusal. Without this the filter would flatten every error to its
    // message alone, and the UI could only print it, never act on it.
    let extra: Record<string, unknown> = {};
    // Technical detail for the server log only (database codes, column names).
    let detail: string | null = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else {
        const { message: m, statusCode: _sc, error: _err, ...rest } = (res ?? {}) as any;
        message = m || message;
        extra = rest;
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      // Malformed query data (missing required field, wrong type, bad enum value).
      // The detail names columns and query internals: it goes to the log, never to
      // the user, who gets the plain 400 sentence.
      status = HttpStatus.BAD_REQUEST;
      const lines = exception.message.trim().split('\n');
      message = defaultErrorMessage(status);
      detail = `Prisma validation: ${lines[lines.length - 1].trim()}`;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Same rule: table and column names stay in the log.
      switch (exception.code) {
        case 'P2002': // unique constraint
          status = HttpStatus.CONFLICT;
          message = 'This already exists. Use a different value and try again.';
          detail = `P2002 unique constraint on ${(exception.meta?.target as string[])?.join(', ') ?? 'unknown'}`;
          break;
        case 'P2003': // foreign key constraint
          status = HttpStatus.BAD_REQUEST;
          message = 'This refers to something that no longer exists. Refresh the page and try again.';
          detail = `P2003 foreign key ${(exception.meta?.field_name as string) ?? 'unknown'}`;
          break;
        case 'P2025': // record not found
          status = HttpStatus.NOT_FOUND;
          message = defaultErrorMessage(status);
          detail = 'P2025 record not found';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          message = defaultErrorMessage(status);
          detail = `Prisma ${exception.code}: ${exception.message.split('\n').pop()?.trim() ?? ''}`;
      }
    }

    // A message that is only the framework's stock text ("Forbidden resource",
    // "Cannot GET /x", "Internal server error") becomes the plain default sentence for
    // its status (common/http/error-messages.ts). A message written where the error
    // was thrown is kept as it is. The log below keeps the original for developers.
    const logged = detail ?? message;
    if (isStockMessage(message, status)) message = defaultErrorMessage(status);

    // Always log server-side so 500s are never opaque in the server console.
    let debug: { name?: string; message?: string; stack?: string[] } | null = null;
    if (status >= 500) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`${request.method} ${request.url} -> ${status}: ${stack}`);
      // In non-production, surface the real error to the client so it's diagnosable
      // straight from the browser Network tab (never leak internals in production).
      if (process.env.NODE_ENV !== 'production' && exception instanceof Error) {
        debug = {
          name: exception.name,
          message: exception.message,
          stack: (exception.stack ?? '').split('\n').slice(0, 6),
        };
      }
    } else if (status >= 400) {
      this.logger.warn(`${request.method} ${request.url} -> ${status}: ${Array.isArray(logged) ? logged.join(', ') : logged}`);
    }

    response.status(status).json({
      success: false,
      data: null,
      message: Array.isArray(message) ? asSentences(message) : message,
      meta: null,
      ...extra,
      ...(debug ? { debug } : {}),
    });
  }
}
