import { clampTake } from './pagination';

describe('clampTake', () => {
  it('clamps to [1, max]', () => {
    expect(clampTake(0)).toBe(1);
    expect(clampTake('9999', 25, 100)).toBe(100);
    expect(clampTake('50', 25, 100)).toBe(50);
  });
  it('falls back on garbage', () => {
    expect(clampTake('abc', 20, 50)).toBe(20);
    expect(clampTake(undefined, 25)).toBe(25);
    expect(clampTake(NaN, 25)).toBe(25);
  });
});
