import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

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
      // The full message is a multi-line code frame — surface only the final
      // human-readable line (e.g. "Argument `created_by_user_id` is missing.").
      status = HttpStatus.BAD_REQUEST;
      const lines = exception.message.trim().split('\n');
      message = `Invalid data: ${lines[lines.length - 1].trim()}`;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': // unique constraint
          status = HttpStatus.CONFLICT;
          message = `Duplicate value for unique field(s): ${(exception.meta?.target as string[])?.join(', ') ?? 'unknown'}`;
          break;
        case 'P2003': // foreign key constraint
          status = HttpStatus.BAD_REQUEST;
          message = `Invalid reference: related record not found (${(exception.meta?.field_name as string) ?? 'foreign key'})`;
          break;
        case 'P2025': // record not found
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          message = `Database request failed (${exception.code})`;
      }
    }

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
      this.logger.warn(`${request.method} ${request.url} -> ${status}: ${Array.isArray(message) ? message.join(', ') : message}`);
    }

    response.status(status).json({
      success: false,
      data: null,
      message: Array.isArray(message) ? message.join(', ') : message,
      meta: null,
      ...extra,
      ...(debug ? { debug } : {}),
    });
  }
}
