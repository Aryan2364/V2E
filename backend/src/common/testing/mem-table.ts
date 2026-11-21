/**
 * Tiny in-memory stand-in for a Prisma model delegate, for authorization specs.
 * Matches rows on SCALAR equality in `where` (nested relation filters are ignored),
 * so a query that forgets `organization_id` / parent id visibly finds the wrong row,
 * and `update`/`delete` reject (like Prisma's P2025) when the extended unique where
 * does not match.
 */
export function memTable<T extends Record<string, any>>(rows: T[]) {
  const matches = (row: T, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in v) return v.in.includes(row[k]);
        if ('not' in v) return row[k] !== v.not;
        return true; // relation / complex filters are not modelled
      }
      return row[k] === v;
    });
  const notFound = () => Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
  const t = {
    rows,
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where))),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw notFound();
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
    delete: jest.fn(async ({ where }: any) => {
      const i = rows.findIndex((r) => matches(r, where));
      if (i < 0) throw notFound();
      return rows.splice(i, 1)[0];
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `new-${rows.length + 1}`, ...data };
      rows.push(row);
      return row;
    }),
  };
  return t;
}
