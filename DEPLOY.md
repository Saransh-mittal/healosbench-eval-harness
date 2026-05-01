# Railway deployment

This monorepo deploys as **3 services in one Railway project**:

1. **Postgres** — Railway's managed plugin
2. **server** — `apps/server` (Hono on Bun)
3. **web** — `apps/web` (Next.js)

Both `server` and `web` deploy from this repo's root (workspaces require it). They differ only in which `railway.*.json` config they point at.

## One-time setup

### 1. Postgres
Railway dashboard → New → Database → Postgres. It auto-exposes `DATABASE_URL`.

### 2. server service
- New → GitHub Repo → pick this repo
- Settings → **Config Path**: `railway.server.json`
- Settings → **Root Directory**: leave empty (`/`)
- Networking → **Generate Domain** (note the URL, e.g. `healosbench-server.up.railway.app`)
- Variables:
  - `DATABASE_URL` → reference Postgres' `DATABASE_URL`
  - `ANTHROPIC_API_KEY` → your key
  - `BETTER_AUTH_SECRET` → 32+ char random string (`openssl rand -hex 32`)
  - `BETTER_AUTH_URL` → `https://<server-domain>`
  - `CORS_ORIGIN` → `https://<web-domain>` (you'll know this after step 3 — come back and set it)
  - `NODE_ENV` → `production`
  - `EVAL_COST_CAP_USD` → optional, e.g. `5`

### 3. web service
- New → GitHub Repo → same repo
- Settings → **Config Path**: `railway.web.json`
- Settings → **Root Directory**: leave empty (`/`)
- Networking → **Generate Domain**
- Variables:
  - `NEXT_PUBLIC_SERVER_URL` → `https://<server-domain>`

### 4. Loop back
Set the server's `CORS_ORIGIN` to the web domain from step 3 and redeploy server.

## What runs on each deploy

- **server build**: `bun install` → `bun run --filter server build` (tsdown bundles workspace deps).
- **server preDeploy**: `bun run --filter @test-evals/db db:push` — applies the current Drizzle schema to Postgres. There are no migration files in `packages/db/src/migrations`, so we use push, not migrate.
- **server start**: `bun --cwd apps/server start` (runs `dist/index.mjs`).
- **web build**: `bun install` → `next build`.
- **web start**: `next start`.

The server reads `PORT` from env (Railway injects it). Default 8787 is for local only.

## Things that will bite you

- **Cookies cross-site**: better-auth is configured with `sameSite: "none"; secure: true`, which only works over HTTPS — fine on Railway, broken on plain `http://`.
- **CORS**: server only allows the single `CORS_ORIGIN`. If you want preview deploys to talk to prod server, you'd need to widen this.
- **db:push is destructive** under some schema changes. For real prod, switch to `drizzle-kit migrate` once you have migration files committed.
- **Eval CLI** (`bun run eval`) is not a service — run it locally or as a Railway one-off `railway run`.
