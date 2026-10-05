import { parseTagIdsQuery } from './tag-ids-query';

describe('parseTagIdsQuery', () => {
  it('parses CSV, trimming and dropping blanks', () => {
    expect(parseTagIdsQuery(' a, b ,,c ')).toEqual(['a', 'b', 'c']);
  });

  it('accepts the repeated-param form (array) and mixed CSV inside it', () => {
    expect(parseTagIdsQuery(['a', 'b,c', ' '])).toEqual(['a', 'b', 'c']);
  });

  it('de-duplicates and caps at 50', () => {
    expect(parseTagIdsQuery(['a', 'a,b'])).toEqual(['a', 'b']);
    expect(parseTagIdsQuery(Array.from({ length: 60 }, (_, i) => `t${i}`))).toHaveLength(50);
  });

  it('returns [] for missing / non-string input instead of throwing', () => {
    expect(parseTagIdsQuery(undefined)).toEqual([]);
    expect(parseTagIdsQuery('')).toEqual([]);
    expect(parseTagIdsQuery({ x: 'y' })).toEqual([]);
    expect(parseTagIdsQuery([{ x: 'y' }, 'a'])).toEqual(['a']);
  });
});
