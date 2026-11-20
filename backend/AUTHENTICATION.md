# Authentication: how a session is carried

Who you are and how the browser keeps you signed in. For *what you may do* once
signed in, see [AUTHORIZATION.md](AUTHORIZATION.md).

Code: `src/auth/` (service, controller, `auth-cookie.ts`, `strategies/jwt.strategy.ts`),
`src/common/guards/jwt-auth.guard.ts`; frontend `lib/api/client.ts`, `lib/api/refresh.ts`,
`lib/auth/context.tsx`.

## The three tokens

| Token | Lifetime | Where the web app keeps it | Purpose |
|---|---|---|---|
| **Access token** (JWT) | 15 min (`JWT_EXPIRES_IN`) | `localStorage` (`access_token`), sent as `Authorization: Bearer` | Authenticates every API call. Carries user id, `organizationId`, `sid`. |
| **Refresh token** (JWT) | 30 days (`JWT_REFRESH_EXPIRES_IN`), sliding | **`httpOnly` cookie `v2e_refresh`**, invisible to JavaScript | Gets a new access token. Rotated on every use. |
| **Selection token** (JWT, `type: "org_selection"`) | 10 min | `localStorage` (`access_token`) while the org picker is open | Lets a person who belongs to several organisations list them and pick one. **Not a session.** |

## Flows

**Sign in** (`POST /auth/login`, or `/auth/admin-login` for the super-admin portal)
1. Identifier (email, or phone + country code) and password are checked. A phone-style
   identifier may contain only digits and `+ - . ( )` and spaces; anything else is "not found".
2. One active organisation: a full session is issued (access + refresh token, a `userSession` row).
3. Several organisations: a **selection token** is returned instead. No refresh cookie is
   set, and any old one is cleared. The picker then calls `GET /auth/my-orgs` and
   `POST /auth/switch-org`; `switch-org` opens the real session.

**Every request:** `JwtStrategy` verifies the access token and re-reads the user, the
organisation status and the membership from the database, so removing someone or
deactivating an organisation takes effect at once, not when their token expires.

**Refresh** (`POST /auth/refresh`): access token expires (the client renews it 60 s early,
or on a 401) → the browser sends the cookie → the server rotates the session's refresh
token, sets the new cookie and returns a new access token. A superseded token that is
replayed is treated as theft and the session is deleted. One refresh at a time across
tabs (`navigator.locks`), so rotation never races.

**Sign out** (`POST /auth/logout`): deletes this device's session and clears the cookie.
`logout-all` deletes every session. Changing a password signs out every *other* device.

## Cookie mode and legacy mode

The refresh token is delivered by one of two transports, chosen **per request** by a header:

| | Cookie mode | Legacy mode |
|---|---|---|
| Client sends | `X-V2E-Auth: cookie` | nothing |
| Refresh token reaches the client | `Set-Cookie: v2e_refresh` (httpOnly) | in the JSON body (`refresh_token`) |
| Refresh request carries it | in the cookie (automatic) | in the body |
| Used by | the web app (its axios client sends the header on every call) | old tabs, cached PWAs, any non-browser or cross-origin client (e.g. a future Capacitor app) |

Cookie attributes: `HttpOnly`, `Secure` (production), `SameSite=Strict`, `Path=/api/v1/auth`
(only the auth endpoints ever receive it), no `Domain` (host-only), `Max-Age` equal to the
token's own expiry. See `auth-cookie.ts`.

**CSRF:** the cookie-based refresh is only honoured when the request also carries
`X-V2E-Auth`. A cross-site page cannot send a custom header without a CORS preflight, and
CORS only allows the configured origins. `SameSite=Strict` is the second layer.

**Migration of older sessions:** a browser that still has a `refresh_token` in
`localStorage` sends it once in the refresh body (with the header). The server rotates it
into the cookie and the client deletes the stored copy. The body token wins over the cookie,
which is why the client removes any stale `refresh_token` on every sign-in.

## Rules for developers

1. **Never store or read the refresh token in JavaScript.** Do not add it to `localStorage`,
   state, logs or a response body for the web app. `withRefreshCookie()` strips it in cookie mode.
2. Any endpoint that issues tokens must pass its result through `withRefreshCookie(req, res, result)`.
   Any endpoint that ends a session must call `clearRefreshCookie(res)`.
3. The **selection token is refused everywhere** by `JwtAuthGuard` except endpoints marked
   `@AllowSelectionToken()` (`my-orgs`, `switch-org`). Mark a new endpoint only if choosing an
   organisation genuinely needs it.
4. The frontend must not treat a selection token as a session (`isSelectionToken` in
   `lib/auth/context.tsx`): refreshing the picker rebuilds the list from `my-orgs`.
5. WebSockets authenticate with the **access token** only (`WsAuthService`); they refuse the
   selection token.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | required | Signing secrets (different, 32+ chars) |
| `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | `15m`, `30d` | Token lifetimes |
| `AUTH_COOKIE_SECURE` | `true` when `NODE_ENV=production`, else `false` | Mark the cookie `Secure`. A `Secure` cookie is dropped by browsers over plain HTTP, so set `false` only for an HTTP-only environment. |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed web origins (comma-separated) |

The browser must reach `/api` on the **same origin** as the page (the Next.js proxy does this,
or a reverse proxy that routes `/api` to the backend). The cookie has no `Domain`, so it is
tied to that origin.

## Rollout and rollback

- **Rollout is safe in any order.** An old frontend against the new backend keeps working
  (legacy mode). The new frontend against an old backend would not set a cookie, so deploy the
  **backend first**, then the frontend.
- **Rollback:** deploying the previous frontend returns to legacy mode. Sessions already moved
  to the cookie cannot be read by the old frontend, so those users sign in once more.
- Existing sessions are not dropped: each one moves into the cookie on its next refresh.

## How it was verified (manual checklist)

Run against the dev servers (`:3001` backend, `:3000` frontend proxy). With `curl -c/-b` and a
cookie jar:

1. Cookie-mode login → `Set-Cookie: v2e_refresh` with `HttpOnly; SameSite=Strict; Path=/api/v1/auth`,
   no `Domain`; body has `access_token` and **no** `refresh_token`.
2. Login without the header → body still has `refresh_token`, no `Set-Cookie`.
3. Refresh with the cookie + header → 200, rotated cookie, no `refresh_token` in body.
4. Refresh with the cookie but **without** the header → 401 (CSRF guard).
5. Refresh with no cookie → 401.
6. Legacy token in the refresh body + header → 200 and a cookie is issued (migration).
7. Logout → cookie cleared; refresh afterwards → 401.
8. Multi-org user: login → `requires_org_selection`, no cookie; `switch-org` → cookie set.
9. In the browser: Application → Cookies shows `v2e_refresh` as HttpOnly; Local Storage has
   `access_token` but **no `refresh_token`**; `document.cookie` does not show it.

## Not covered yet

- The **access token** is still in `localStorage` (15 minutes). Moving it to memory would also
  require changing the WebSocket handshake and the proactive-refresh timer.
- Login has **no rate limiting**, and there is no Content-Security-Policy; both reduce the
  impact of password guessing and XSS and should be added.
