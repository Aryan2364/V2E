import { BadRequestException } from '@nestjs/common';

export const MAX_PAGE_SIZE = 100;

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

function toWholeNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || !/^\s*-?\d+\s*$/.test(v)) return NaN;
  return Number(v);
}

/**
 * Validate the opt-in `page` / `pageSize` query params. Absent (or empty) values
 * stay `undefined`, which callers treat as "not paginated". Anything else must be
 * a whole number in range, otherwise a clear 400 instead of a NaN-driven 500.
 */
export function parsePagination(
  page?: unknown,
  pageSize?: unknown,
): { page?: number; pageSize?: number } {
  let p: number | undefined;
  let s: number | undefined;
  if (!isBlank(page)) {
    p = toWholeNumber(page);
    if (!Number.isInteger(p) || p < 1) {
      throw new BadRequestException('page must be a whole number of 1 or more');
    }
  }
  if (!isBlank(pageSize)) {
    s = toWholeNumber(pageSize);
    if (!Number.isInteger(s) || s < 1 || s > MAX_PAGE_SIZE) {
      throw new BadRequestException(`pageSize must be a whole number between 1 and ${MAX_PAGE_SIZE}`);
    }
  }
  return { page: p, pageSize: s };
}

/** Validate the audit log's `skip` / `take` offset params (same 400 behaviour). */
export function parseSkipTake(
  skip?: unknown,
  take?: unknown,
  maxTake = 200,
): { skip?: number; take?: number } {
  let sk: number | undefined;
  let tk: number | undefined;
  if (!isBlank(skip)) {
    sk = toWholeNumber(skip);
    if (!Number.isInteger(sk) || sk < 0) {
      throw new BadRequestException('skip must be a whole number of 0 or more');
    }
  }
  if (!isBlank(take)) {
    tk = toWholeNumber(take);
    if (!Number.isInteger(tk) || tk < 1 || tk > maxTake) {
      throw new BadRequestException(`take must be a whole number between 1 and ${maxTake}`);
    }
  }
  return { skip: sk, take: tk };
}
