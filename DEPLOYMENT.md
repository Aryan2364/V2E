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

## Sign-in cookie (refresh token)

The web app keeps the refresh token in an **httpOnly cookie** (`v2e_refresh`), not in
browser storage. Things to know when deploying:

- **Deploy the backend first, then the frontend.** An older frontend keeps working against
  the new backend; the new frontend needs the new backend to set the cookie.
- **It needs HTTPS in production.** The cookie is `Secure` whenever the container runs with
  `NODE_ENV=production` (the Dockerfile sets it). Over plain HTTP the browser would drop it and
  people would be signed out after 15 minutes. If an environment really is HTTP-only, set
  `AUTH_COOKIE_SECURE=false` in its env file.
- **Same origin.** The browser must reach `/api` on the same host as the page (the Next proxy,
  or nginx routing `/api` to the backend). Make sure nginx passes `Set-Cookie` and `Cookie`
  through (it does by default) and does not add a `Domain` to cookies.
- **Nobody is signed out by the upgrade.** Each existing session moves into the cookie on its
  next token refresh. Rolling back the frontend returns to the old behaviour, and anyone already
  moved signs in once more.
- **Check after deploying:** sign in, then DevTools → Application. Cookies should show
  `v2e_refresh` as **HttpOnly** and **Secure**; Local Storage should have `access_token` and
  **no** `refresh_token`.

Full details: [backend/AUTHENTICATION.md](backend/AUTHENTICATION.md).

---

## Rate limiting

The backend rate-limits the **auth routes only** (`backend/src/common/rate-limit/`): sign-in,
admin sign-in, register, password reset and change password. There is no API-wide limit yet.

- **Nothing to configure in the proxy.** Every limit is counted per account (email / phone),
  so colleagues behind one office IP never block each other.
- **Failed sign-ins per IP:** an IP with 500 wrong sign-ins (any accounts) in 15 minutes is
  blocked from signing in for the rest of that window. Successful sign-ins never count, so an
  office signing in together is not affected. Code: `backend/src/common/rate-limit/failed-login.limiter.ts`.
- **Real client IP.** The backend reads the client IP from `X-Forwarded-For`, which Caddy's
  `reverse_proxy` sends by default and Next.js passes on. It trusts that header only from
  proxies on loopback / private networks (`backend/src/common/http/trust-proxy.ts`); override with `TRUST_PROXY`
  in the backend env (a hop count such as `2`, or an Express trust list). If the header ever
  stops arriving, every user looks like one IP; the per-account limits still protect
  sign-in either way.
- **Keep ports 3300 and 4300 closed to the internet** (EC2 security group). Reaching the app
  directly, past Caddy, lets a client write its own `X-Forwarded-For` and pick its IP.
- Counts are kept in memory. That is right for one backend container; if the backend is ever
  scaled to several, move the storage to Redis.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Signed out after ~15 minutes on one environment only | The refresh-token cookie isn't being stored or sent: the site is served over HTTP while the cookie is `Secure` (set `AUTH_COOKIE_SECURE=false` for an HTTP-only environment), or a proxy strips `Set-Cookie`. See "Sign-in cookie" above. |
| "Too many attempts" when signing in | The account hit its limit (e.g. 10 wrong passwords in 15 minutes). It clears on its own when the wait shown has passed, or when the backend restarts. See "Rate limiting" above. |
| Actions build fails on push | Open the failed job in the Actions tab; the red step shows why (usually a compile/build error). |
| `docker compose pull` → `denied` / `unauthorized` | Redo Part B (token needs `read:packages`; `docker login ghcr.io` again). |
| Backend restarts over and over | `logs` it. Usually `DATABASE_URL` wrong or RDS security group not allowing EC2 (Part C.3). |
| Changed code but EC2 shows old version | You pushed but didn't run `./deploy.sh`, or the Actions build hasn't finished yet. |
| Frontend loads but API calls fail | Check `BACKEND_URL` (compose sets it to `http://backend:3001`) and that the backend container is Up. |

> Note: document/PowerPoint preview (LibreOffice) is **not** in the backend image
> yet — that feature needs LibreOffice installed in the container. Everything else
> runs. Tell me if you want that added to the backend Dockerfile.
