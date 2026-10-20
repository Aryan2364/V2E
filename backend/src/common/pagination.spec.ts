import { BadRequestException } from '@nestjs/common';
import { parsePagination, parseSkipTake } from './pagination';

describe('parsePagination', () => {
  it('treats absent or empty values as not paginated', () => {
    expect(parsePagination()).toEqual({ page: undefined, pageSize: undefined });
    expect(parsePagination('', '')).toEqual({ page: undefined, pageSize: undefined });
  });
  it('parses valid values', () => {
    expect(parsePagination('2', '50')).toEqual({ page: 2, pageSize: 50 });
    expect(parsePagination(1, 100)).toEqual({ page: 1, pageSize: 100 });
    expect(parsePagination('3')).toEqual({ page: 3, pageSize: undefined });
  });
  it.each(['abc', '0', '-1', '1.5', '1e3', 'NaN'])('rejects page=%s', (v) => {
    expect(() => parsePagination(v)).toThrow(BadRequestException);
  });
  it.each(['abc', '0', '-5', '101', '9999'])('rejects pageSize=%s', (v) => {
    expect(() => parsePagination('1', v)).toThrow(BadRequestException);
  });
});

describe('parseSkipTake', () => {
  it('accepts absent and valid values', () => {
    expect(parseSkipTake()).toEqual({ skip: undefined, take: undefined });
    expect(parseSkipTake('0', '200')).toEqual({ skip: 0, take: 200 });
  });
  it('rejects bad values', () => {
    expect(() => parseSkipTake('abc')).toThrow(BadRequestException);
    expect(() => parseSkipTake('-1')).toThrow(BadRequestException);
    expect(() => parseSkipTake('0', '0')).toThrow(BadRequestException);
    expect(() => parseSkipTake('0', '201')).toThrow(BadRequestException);
  });
});
