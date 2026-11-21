# Deploying V2E with GHCR + EC2

This is the first-time walkthrough. The flow is:

```
  you push to GitHub  ─▶  GitHub Actions builds 2 images  ─▶  pushes them to GHCR
                                                                     │
                                     EC2 pulls the images  ◀─────────┘
                                     and runs them with docker compose
```

You build **once** in GitHub's cloud. EC2 never builds — it only pulls and runs.
Nothing here rebuilds on the server.

Files this uses:
- `.github/workflows/deploy-images.yml` — the build+push pipeline (runs in GitHub)
- `docker-compose.deploy.yml` — runs the pre-built images (used **on EC2**)
- `.env.production.example` — template for the real secrets (fill in **on EC2**)
- `deploy.sh` — one-command redeploy helper (run **on EC2**)

---

## Part A — Get GitHub building the images (one-time)

1. **Commit and push these new files, then get them onto `main`.**
   The workflow triggers on pushes to `main`, so it must be on that branch.

   ```bash
   git add .github/workflows/deploy-images.yml docker-compose.deploy.yml \
           .env.production.example deploy.sh DEPLOYMENT.md
   git commit -m "ci: build images to GHCR + EC2 deploy setup"
   # merge your branch into main (via PR or fast-forward), then:
   git push origin main
   ```

2. **Watch it build.** Go to your repo on GitHub → **Actions** tab → you'll see
   *"Build & push images"* running. It builds `backend` and `frontend` in
   parallel. First run takes a few minutes; later runs are faster (cached).
   You can also trigger it by hand anytime: Actions → the workflow → **Run workflow**.

3. **Confirm the images exist.** Repo → right sidebar **Packages**, or your
   profile → **Packages**. You should see `v2e-backend` and `v2e-frontend`.
   They start out **private** — that's fine, EC2 will log in to pull them.

---

## Part B — Let EC2 pull from GHCR (one-time)

Private GHCR images need a login. On EC2 you log in **once** with a GitHub token.

1. **Create a token** (on github.com, from any browser):
   Settings → Developer settings → **Personal access tokens** → **Tokens (classic)**
   → Generate new token (classic). Give it the **`read:packages`** scope only.
   Copy the token (starts with `ghp_...`).

2. **SSH into EC2 and log Docker in to GHCR:**
   ```bash
   echo "ghp_YOUR_TOKEN_HERE" | docker login ghcr.io -u Aryan2364 --password-stdin
   ```
   You should see `Login Succeeded`. This is saved to `~/.docker/config.json`, so
   you only do it once (until the token expires).

---

## Part C — Set up the app on EC2 (one-time)

1. **Put the two run-files on the box.** Easiest is to clone the repo (it already
   contains `docker-compose.deploy.yml` and `deploy.sh` after Part A), or `scp`
   just those two files up. In a working directory on EC2:
   ```bash
   git clone https://github.com/Aryan2364/V2E.git
   cd V2E
   ```

2. **Create the real secrets file** (this is NOT in git — you make it here):
   ```bash
   cp .env.production.example .env.production
   nano .env.production      # fill in RDS URL, JWT secrets, SMTP, R2, etc.
   ```
   - `DATABASE_URL` → your **RDS endpoint** (keep `sslmode=require`).
   - Generate secrets right on the box: `openssl rand -base64 48`.

3. **Make sure EC2 can reach RDS.** In the AWS console, the **RDS security group**
   must allow inbound PostgreSQL (port 5432) from the **EC2 instance's security
   group**. Without this, the backend can't connect and will crash-loop.

---

## Part D — Deploy (every time you ship)

On EC2, from the folder with `docker-compose.deploy.yml`:

```bash
./deploy.sh
```

That runs: pull newest images → restart containers → prune old images → show status.
The backend automatically runs `prisma migrate deploy` on startup, so DB schema
changes apply themselves.

Check it's healthy:
```bash
docker compose -f docker-compose.deploy.yml ps      # both should be "Up"
docker compose -f docker-compose.deploy.yml logs -f  # tail logs (Ctrl-C to stop)
```

**The everyday loop** becomes: push to `main` → wait for the green check in the
Actions tab → SSH to EC2 → `./deploy.sh`. That's it.

---

## Part E — Staging deploys itself (every push to main)

Every push to `main` whose checks pass is deployed automatically to
**https://v2estaging.rgbindia.com**:

```
push/merge to main → CI (lint, types, tests, build) → build images → deploy-staging
                                                                        │
                       SSH to server → pull images for that commit → restart → wait healthy
```

Production does **not** change automatically. Once staging looks right,
deploy production by hand with `./deploy.sh` (Part D), as before. If the CI
checks fail, nothing is built and staging is not touched. If staging comes up
unhealthy, the job fails (red X in the Actions tab) and prints the backend logs.

Staging runs `docker-compose.staging-deploy.yml` (project name `v2e-staging`,
ports 3301/4301, matching the Caddy block). The workflow copies that file to the
server on every deploy, so you never edit it on the box.

### One-time setup

1. **On the server, make the staging folder and its secrets file:**
   ```bash
   mkdir -p ~/v2e-staging && cd ~/v2e-staging
   nano .env.staging     # copy .env.staging.example; STAGING database only
   ```
   `.env.staging` needs its own `DATABASE_URL` (a staging database, **never**
   production's: migrations run against it on every deploy), plus `JWT_SECRET`
   and `JWT_REFRESH_SECRET`, each 32+ characters, different from each other and
   from production's (`openssl rand -base64 48`).

2. **Stop any old staging containers** holding ports 3301/4301 (for example ones
   started from `docker-compose.staging.yml`, which built on the server):
   ```bash
   docker ps --filter publish=3301 --filter publish=4301
   docker stop <ids> && docker rm <ids>
   ```

3. **Make a deploy key** (on your own computer, not the server):
   ```bash
   ssh-keygen -t ed25519 -f v2e-staging-deploy -N "" -C "github-actions-staging"
   ```
   Add the contents of `v2e-staging-deploy.pub` as a new line in
   `~/.ssh/authorized_keys` on the server, for the user that runs Docker.

4. **Get the server's host key** (so Actions can verify it is really your server):
   ```bash
   ssh-keyscan -H <server-ip-or-hostname>
   ```

5. **Add the secrets** in GitHub → repo → Settings → Secrets and variables →
   Actions → New repository secret:

   | Secret | Value |
   |---|---|
   | `STAGING_SSH_HOST` | server IP or hostname |
   | `STAGING_SSH_USER` | the SSH user from step 3 (e.g. `ubuntu`) |
   | `STAGING_SSH_KEY` | full contents of the private key file `v2e-staging-deploy` |
   | `STAGING_SSH_KNOWN_HOSTS` | the output of step 4 |
   | `STAGING_APP_DIR` | the folder from step 1, as an absolute path (e.g. `/home/ubuntu/v2e-staging`) |

   Then delete the private key file from your computer.

6. **Protect `main`** (recommended): Settings → Branches → Add rule for `main` →
   "Require a pull request before merging" and "Require status checks to pass"
   (pick `Backend` and `Frontend`). Developers then merge through pull requests,
   and nothing reaches staging without green checks.

The server's existing `docker login ghcr.io` (Part B) also covers the new
`v2e-frontend-staging` image. To test without pushing, open Actions →
"Build & push images" → Run workflow.

---

## Ports & domains

The containers publish:
- frontend → host port **3300**
- backend  → host port **4300**

For `https://v2e.rgbindia.com` to work you need a reverse proxy (nginx/Caddy) on
EC2 terminating HTTPS and forwarding the domain to port 3300, plus `/api` to the
backend. Also open ports 80/443 in the EC2 security group. (If you already have
nginx set up for this app, just point it at 3300/4300.) Say the word and I'll
generate the nginx config.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Actions build fails on push | Open the failed job in the Actions tab; the red step shows why (usually a compile/build error). |
| `docker compose pull` → `denied` / `unauthorized` | Redo Part B (token needs `read:packages`; `docker login ghcr.io` again). |
| Backend restarts over and over | `logs` it. Usually `DATABASE_URL` wrong or RDS security group not allowing EC2 (Part C.3). |
| Changed code but EC2 shows old version | You pushed but didn't run `./deploy.sh`, or the Actions build hasn't finished yet. |
| Frontend loads but API calls fail | Check `BACKEND_URL` (compose sets it to `http://backend:3001`) and that the backend container is Up. |

> Note: document/PowerPoint preview (LibreOffice) is **not** in the backend image
> yet — that feature needs LibreOffice installed in the container. Everything else
> runs. Tell me if you want that added to the backend Dockerfile.
