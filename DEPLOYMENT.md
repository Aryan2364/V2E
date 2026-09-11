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
