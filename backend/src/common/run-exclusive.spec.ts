import { runExclusive } from './run-exclusive';

describe('runExclusive (in-process guard; no DATABASE_URL)', () => {
  const saved = process.env['DATABASE_URL'];
  beforeAll(() => delete process.env['DATABASE_URL']);
  afterAll(() => {
    if (saved !== undefined) process.env['DATABASE_URL'] = saved;
  });

  it('skips a second concurrent run of the same job', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fn = jest.fn(() => gate);
    const first = runExclusive('job-a', fn);
    await runExclusive('job-a', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('allows different jobs concurrently and re-runs after completion', async () => {
    const a = jest.fn(async () => undefined);
    await Promise.all([runExclusive('job-b', a), runExclusive('job-c', a)]);
    expect(a).toHaveBeenCalledTimes(2);
    await runExclusive('job-b', a);
    expect(a).toHaveBeenCalledTimes(3);
  });

  it('releases the guard and swallows errors when fn throws', async () => {
    await expect(runExclusive('job-d', async () => { throw new Error('boom'); })).resolves.toBeUndefined();
    const fn = jest.fn(async () => undefined);
    await runExclusive('job-d', fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
