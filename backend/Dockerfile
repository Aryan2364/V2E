# Builds the V2E NestJS API into a runnable image.
#
# MULTI-STAGE. Stage 1 compiles TypeScript to dist/; stage 2 starts clean and
# installs only the production dependency tree. The single-stage version this
# replaced shipped a 900 MB node_modules -- the Nest CLI, SWC, TypeScript, Jest,
# ESLint and every @types package -- to run 9 MB of compiled output, and the
# 19 GB server volume holds five apps' images.
#
# The runner re-runs `npm ci --omit=dev` rather than copying stage 1's
# node_modules and pruning it: prune leaves behind whatever a transitive dep
# hoisted, and a clean install is the only way to be certain the tree matches
# package-lock.json for production exactly.

# ---------------------------------------------------------------------------
# Stage 1: builder -- full dependency tree, generate the client, compile.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --legacy-peer-deps && npx prisma generate

COPY . .
# nest build is memory-hungry and OOMs at 2GB. The build now runs on CI runners
# (16GB), not on the small EC2 box, so give V8 a 4GB heap.
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

# ---------------------------------------------------------------------------
# Stage 2: runner -- production deps and the compiled output, nothing else.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner
# tzdata so the TZ env var (Asia/Kolkata) is honored by the OS, not just V8/ICU
RUN apk add --no-cache tzdata
WORKDIR /app

ENV NODE_ENV=production

# prisma/ carries BOTH the schema and the 89 migrations, and both are needed at
# RUNTIME -- the CMD below runs `prisma migrate deploy` on every boot, which
# reads the migrations directory. This is why the `prisma` CLI stays in
# `dependencies` and must survive --omit=dev; moving it to devDependencies would
# leave the container unable to start.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --legacy-peer-deps && npx prisma generate && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 3001

# Unchanged: migrations are applied at boot, then the API starts. Kept as a
# single `sh -c` so a failed migration stops the container instead of starting
# an API against a schema it does not match.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
