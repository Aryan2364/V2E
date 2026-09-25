# Builds the V2E Next.js frontend into a runnable image.
#
# MULTI-STAGE. Stage 1 installs everything and compiles; stage 2 ships only the
# standalone server Next emits. The single-stage version this replaced was 2 GB,
# most of it a webpack build cache and a compiler the running container cannot
# use, on a 19 GB volume shared by five apps.
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
# The postinstall hook (scripts/copy-pdfjs.mjs) runs during `npm ci`, so the
# scripts dir must already be present in the image before install. It copies
# pdf.min.mjs and pdf.worker.min.mjs out of node_modules into public/, where
# MaterialViewer loads them by absolute URL at runtime -- they are NOT in the
# webpack graph, so nothing but the public/ copy below carries them.
COPY scripts ./scripts
RUN npm ci

COPY . .

# Both are compiled in at BUILD time, not read at runtime: NEXT_PUBLIC_WS_URL is
# substituted into the browser bundle, and the /api/* rewrite destination is
# frozen into routes-manifest.json. The workflow passes the production values as
# build-args (see .github/workflows/deploy-images.yml); these defaults are for
# local builds only. Changing BACKEND_URL therefore needs a rebuild, not a
# restart -- true of `next start` too, and unchanged by the standalone output.
ARG NEXT_PUBLIC_WS_URL=http://localhost:3001
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

ARG BACKEND_URL=http://localhost:3001
ENV BACKEND_URL=$BACKEND_URL

# Single-threaded static gen (next.config cpus:1) + a modest heap so the build
# fits a small instance (pair with ~4G swap on 2-4GB boxes). NOT 8G — that OOM-
# froze the host. Bump if you move to a bigger builder.
RUN NODE_OPTIONS=--max-old-space-size=3072 npm run build

# ---------------------------------------------------------------------------
# Stage 2: runner -- the standalone server and its assets, nothing else.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# The standalone server takes these from the environment rather than CLI flags.
# HOSTNAME must be 0.0.0.0: the process has to accept connections arriving from
# outside its own network namespace or Docker's published port reaches nothing.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN mkdir -p .next/cache && chown -R node:node /app

# `output: 'standalone'` in next.config.mjs makes next build trace which of the
# installed packages the app actually reaches and emit a server.js beside just
# those. Static assets sit outside that trace deliberately, so .next/static and
# public/ are copied separately -- without them the app serves HTML with no CSS
# and 404s both pdf.js files.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node

EXPOSE 3000

# NOT `npm start` (= `next start`), which needs the dependency tree this stage
# no longer carries. The standalone bundle is started by its own server.js.
CMD ["node", "server.js"]
