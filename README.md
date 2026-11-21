# V2E

V2E is a multi-tenant work-management platform: tasks, meetings, processes and workflows, learning material and communication, with role- and scope-based access per organization. It ships as a web app plus an installable phone app (tasks and meetings).

## Layout

| Path | What |
| --- | --- |
| `backend/` | NestJS + Prisma + PostgreSQL API ([README](backend/README.md), [authorization rules](backend/AUTHORIZATION.md)) |
| `frontend/` | Next.js (App Router) + Tailwind web and phone app |
| `docs/` | Design briefs, plans and reviews |
| `.github/workflows/` | `ci.yml` (checks) and `deploy-images.yml` (image build/push) |
| `.githooks/` | Pre-push checks (enabled automatically by `npm install`) |
| `docker-compose*.yml`, `deploy.sh` | Local/staging/production container setups |

## Quick start

Requires Node 20 and PostgreSQL.

```bash
# backend (http://localhost:3001)
cd backend
cp .env.example .env        # set DATABASE_URL and secrets
npm ci --legacy-peer-deps
npx prisma migrate dev
npm run start:dev

# frontend (http://localhost:3000), in a second terminal
cd frontend
npm ci
npm run dev
```

See [SETUP.md](SETUP.md) for more detail.

## CI

`.github/workflows/ci.yml` runs on every pull request and push to main. Backend: prisma generate, `tsc`, lint, jest, build. Frontend: lint, `tsc`, unit tests, build. Docker images are built and pushed to GHCR by `deploy-images.yml` only after CI succeeds on main.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md).
