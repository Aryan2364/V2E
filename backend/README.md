# V2E backend

NestJS 11 API (TypeScript) on PostgreSQL via Prisma. Multi-tenant: every record belongs to an organization.

## Setup

```bash
cd backend
cp .env.example .env      # then fill in the values below
npm ci --legacy-peer-deps
npx prisma generate
npx prisma migrate dev    # applies prisma/migrations to your local database
npm run db:seed:baseline  # optional: baseline data
npm run start:dev         # http://localhost:3001  (Swagger: /api/docs)
```

Requires Node 20 and a running PostgreSQL.

## Environment (`.env`)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Token signing secrets |
| `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | Token lifetimes (e.g. `15m`, `30d`) |
| `PORT` | HTTP port (default 3001) |
| `FRONTEND_URL` / `CORS_ORIGIN` | Allowed browser origin / links in emails |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Outgoing mail |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push |

`.env.example` is the source of truth for the full list.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run start:dev` | Watch mode (SWC) |
| `npm run build` / `start:prod` | Compile to `dist/` / run it |
| `npm run lint` | ESLint with auto-fix; `lint:check` reports only (used by CI) |
| `npm test` | Jest unit tests (`test:cov` for coverage, `test:e2e` for e2e) |
| `npm run db:seed:baseline` / `db:seed:default-roles` | Seed data |
| `npm run db:snapshot` | Dump data to `prisma/seed-data.sql` |

Ad-hoc maintenance scripts live in `scripts/` and `scripts/oneoff/` (run with `npx ts-node`; read them first, several are destructive).

## Migrations

Schema lives in `prisma/schema.prisma`; migrations in `prisma/migrations`.

- Develop: edit the schema, then `npx prisma migrate dev --name <change>` and commit the generated folder.
- Production: the Docker image runs `prisma migrate deploy` on every boot, before the API starts.
- Never edit a migration that has been merged.

## Tests

`npm test` runs the `*.spec.ts` files beside the source. CI (`.github/workflows/ci.yml`) runs type-check, lint, tests and build on every PR.

## Authorization

The guards only check authentication and organization membership, not row-level access. Every `:id` route must gate the specific object and scope queries by `organization_id`. Read [AUTHORIZATION.md](./AUTHORIZATION.md) before adding or editing any endpoint; `src/tasks/tasks.service.ts` is the reference implementation.
