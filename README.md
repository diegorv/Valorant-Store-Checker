<p align="center">
  <img src="public/icons/Valorant_Store_Checker.webp" width="750" alt="Valorant Store Checker">
</p>

<h1 align="center">Valorant Store Checker</h1>

<p align="center">
  Check your daily Valorant store, Night Market, and bundles — without launching the game.
</p>

<p align="center">
  <a href="https://github.com/yugam23/Valorant-Store-Checker/actions/workflows/ci.yml">
    <img src="https://github.com/yugam23/Valorant-Store-Checker/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://vercel.com/new/clone?repository-url=https://github.com/yugam23/Valorant-Store-Checker">
    <img src="https://vercel.com/button" alt="Deploy with Vercel">
  </a>
</p>

---

## Overview

Valorant Store Checker is a production-grade, security-hardened Next.js application that authenticates with Riot's OAuth flow and surfaces your personalized in-game store. It supports multi-step authentication (including MFA and browser-based fallback), multi-account switching, store rotation history, wishlists, inventory browsing, and full profile/rank display — all without ever opening the Valorant client.

Sessions are encrypted at rest using AES-256-GCM, tokens never leave the server, and all Riot cookies are stored server-side only. The project ships with a comprehensive Vitest test suite and can be self-hosted on Vercel or with Docker.

---

## Features

| Feature            | Description                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------ |
| **Daily Store**    | View all 4 daily rotating skins with VP pricing and tier icons                             |
| **Night Market**   | Check your personalized Night Market discounts when active                                 |
| **Bundles**        | Browse current featured bundles with full item breakdowns and pricing                      |
| **Wallet**         | See your current VP and Radianite Point balances                                           |
| **Store History**  | Browse past store rotations indexed by date, with repeat and price statistics              |
| **Wishlist**       | Bookmark skins you want; get highlighted when they appear in your store                    |
| **Inventory**      | View all cosmetics you currently own (skins, sprays, cards, etc.) and export them as a PDF |
| **Profile & Rank** | Display your Riot ID, account level, current rank, and RR progress                         |
| **Multi-Account**  | Link and switch between multiple Riot accounts in one session                              |
| **MFA Support**    | Full multi-factor authentication flow for 2FA-protected accounts                           |
| **Secure Auth**    | Riot OAuth flow with browser-based Playwright fallback                                     |

---

## Tech Stack

| Category          | Technology                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| **Framework**     | [Next.js 16](https://nextjs.org) (App Router, Server Components)                                        |
| **Language**      | [TypeScript 6](https://www.typescriptlang.org) (strict + `noUncheckedIndexedAccess`)                    |
| **Styling**       | [Tailwind CSS v4](https://tailwindcss.com)                                                              |
| **UI Primitives** | [Radix UI](https://www.radix-ui.com), [Lucide Icons](https://lucide.dev), [CVA](https://cva.style)      |
| **Validation**    | [Zod](https://zod.dev)                                                                                  |
| **Server DB**     | [LibSQL / Turso](https://turso.tech) (SQLite)                                                           |
| **Cache**         | [Upstash Redis](https://upstash.com) (REST) — or bundled Redis + [SRH](https://github.com/hiett/serverless-redis-http) in Docker |
| **Client DB**     | [Dexie.js](https://dexie.org) (IndexedDB — store history)                                               |
| **PDF Export**    | [jspdf](https://github.com/parallax/jsPDF) & [html2canvas-pro](https://github.com/niklasvh/html2canvas) |
| **Auth Fallback** | [Playwright](https://playwright.dev) (headless browser cookie extraction)                               |
| **Testing**       | [Vitest](https://vitest.dev) + [MSW v2](https://mswjs.io)                                               |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser (Client)                  │
│  React 19 · Tailwind v4 · Dexie (IndexedDB history) │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP (HTTP-only cookie JWT)
┌──────────────────────▼──────────────────────────────┐
│               Next.js App Router (Server)            │
│                                                      │
│  RSCs + API Routes                                   │
│  ├── /api/auth       ← multi-step Riot OAuth         │
│  ├── /api/profile    ← rank + identity               │
│  ├── /api/inventory  ← owned cosmetics               │
│  ├── /api/wishlist   ← bookmark management           │
│  └── /api/accounts   ← multi-account switching       │
│                                                      │
│  Session Layer                                       │
│  ├── session-store.ts   (encrypt-on-write / decrypt) │
│  ├── session-crypto.ts  (AES-256-GCM)                │
│  └── session-db.ts      (LibSQL + hourly cleanup)    │
│                                                      │
│  Riot Module                                         │
│  ├── riot-auth.ts       (OAuth + MFA + reauth)       │
│  ├── riot-store.ts      (daily / night market / bundles) │
│  ├── riot-tokens.ts     (entitlements extraction)    │
│  └── riot-inventory.ts  (cosmetics)                  │
└──────────────────────┬──────────────────────────────┘
                       │
         ┌─────────────┼──────────────┐
         ▼             ▼              ▼
  LibSQL / Turso   Redis (REST)   Riot + HenrikDev APIs
  (encrypted       (cache +       (auth, store, loadout,
   sessions)        rate limit)    rank)
```

**Key patterns:**

- **Reference-token sessions** — JWT in cookie carries only a session ID; all data stays in SQLite
- **RSC deduplication** — `React.cache()` wraps `getSession()` to deduplicate DB reads per render pass
- **withSession HOF** — all protected API routes wrapped with `withSession(handler)` for zero-boilerplate auth
- **Redis-backed caches** — store (until the next rotation), profile (6 hours) and Valorant catalog data (24 hours) are cached in Redis, so page reloads don't re-hit Riot or HenrikDev; inventory is cached in memory. Without Redis the app still works, just without these caches
- **Auth rate limiting** — sliding-window limit on login attempts per IP, backed by Redis (fails open when Redis is not configured)
- **Shard memoization** — the first Riot PD request tries the session's shard alone and remembers the one that works, instead of probing every shard
- **Section-level error boundaries** — each store section fails independently; the rest of the page renders

---

## Environment Variables

### Required

| Variable         | Description                                                                        |
| ---------------- | ---------------------------------------------------------------------------------- |
| `SESSION_SECRET` | Secret for signing session JWTs. Min 32 chars. Generate: `openssl rand -base64 32` |

### Recommended

| Variable         | Description                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ENCRYPTION_KEY` | AES-256-GCM key for encrypting Riot cookies at rest. **Must be 64 hex chars (32 bytes).** Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `HENRIK_API_KEY` | [HenrikDev API](https://docs.henrikdev.xyz) key for rank and level data. The app degrades gracefully without it.                                                               |

### Database (Production)

| Variable             | Description                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `TURSO_DATABASE_URL` | LibSQL connection URL from [Turso](https://turso.tech) (e.g. `libsql://...`) |
| `TURSO_AUTH_TOKEN`   | Turso auth token for the above database                                      |
| `SESSION_DB_PATH`    | Override local SQLite path (default: `.session-data/sessions.db`)            |

### Cache & Rate Limiting (Recommended)

| Variable                   | Description                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `UPSTASH_REDIS_REST_URL`   | Upstash Redis REST URL. Enables the store/profile/catalog caches and auth rate limiting                                                      |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token                                                                                                                     |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Used as a fallback for the two variables above — these are the names the Vercel Marketplace Upstash integration injects             |
| `RATE_LIMIT_REQS_PER_MIN`  | Max auth requests per minute per IP (default: `10`)                                                                                          |
| `TRUSTED_PROXY_HOPS`       | Number of reverse proxies in front of the app (default: `1`). See [Rate limiting behind a reverse proxy](#rate-limiting-behind-a-reverse-proxy) |
| `SRH_TOKEN`                | **Docker only.** Token for the bundled Redis REST proxy. Generate: `openssl rand -hex 32`                                                    |

> **Important:** Without `ENCRYPTION_KEY`, Riot session cookies are stored in plaintext in the database. Setting this variable is strongly recommended for any deployment accessible to others.

### Rate limiting behind a reverse proxy

The auth rate limiter buckets attempts per client IP, which it reads from `X-Forwarded-For`. Clients can send that header themselves, so the app only trusts the hops a proxy you control appended: each proxy appends the address it saw, and `TRUSTED_PROXY_HOPS` says how many entries to count from the **right** of the list.

| Deployment                                       | `TRUSTED_PROXY_HOPS` |
| ------------------------------------------------ | -------------------- |
| One reverse proxy (the Caddy example below, nginx) | `1` (default)        |
| CDN in front of your own proxy (e.g. Cloudflare → Caddy) | `2`            |
| One reverse proxy (default)                       | `1`                  |
| Ignore forwarded headers entirely                 | `0`                  |

The default `1` reads the rightmost entry, which only your proxy can write — and when no proxy is present, Next fills that entry in from the socket, so each caller still gets its own bucket. Exposing the app directly with no proxy in front is the one case the default does not cover: there the caller can supply the header itself, so put a proxy in front before exposing it. A request that arrives with fewer hops than you configured (someone reaching your origin past the CDN, say) shares the fallback bucket rather than falling back to a header the caller controls. Setting `0` ignores forwarded headers entirely: nothing is forgeable, but every caller shares one bucket.

---

## Deployment

### Option 1: Deploy with Vercel (Recommended)

1. Click **Deploy with Vercel** above, or import the repo at [vercel.com/new](https://vercel.com/new).
2. Add the following environment variables in the Vercel project settings:
   - `SESSION_SECRET` ← required
   - `ENCRYPTION_KEY` ← strongly recommended
   - `HENRIK_API_KEY` ← optional (rank data)
   - `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` ← for persistent sessions across deployments
   - Upstash Redis ← recommended (cache + auth rate limiting)

   Both Turso and Upstash can be added from the project's **Storage** tab (Vercel Marketplace), which injects the variables automatically.

3. Click **Deploy**.

> **Turso integration:** when connecting the Turso database, leave **"Create Database Branch For Deployment"** unchecked for Production. When it is checked, every production deploy gets a brand-new empty database, which logs every user out and wipes wishlists on each deploy.

> Every push to `main` triggers an automatic redeployment.

### Option 2: Self-host with Docker

Run the app on your own server (VPS, home lab, NAS) so that Riot session
cookies never leave infrastructure you control.

1. **Clone and configure:**

   ```bash
   git clone https://github.com/yugam23/Valorant-Store-Checker.git
   cd Valorant-Store-Checker
   cp .env.example .env
   ```

2. **Generate the three secrets** and paste them into `.env`:

   ```bash
   openssl rand -base64 32   # SESSION_SECRET
   openssl rand -hex 32      # ENCRYPTION_KEY (must be 64 hex chars)
   openssl rand -hex 32      # SRH_TOKEN (bundled Redis REST proxy)
   ```

3. **Build and start:**

   ```bash
   docker compose up -d --build
   ```

4. Open [http://localhost:3000](http://localhost:3000). If port 3000 is taken, set `APP_PORT` in `.env`.

What the Docker setup does:

- Multi-stage build on `node:22-bookworm-slim` using Next.js standalone output (no dev dependencies, no Playwright browsers in the image).
- Runs as an unprivileged user with a read-only root filesystem, all capabilities dropped and `no-new-privileges`.
- Stores the encrypted SQLite session database in a named volume (`session-data`), so sessions survive rebuilds. Set `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` in `.env` if you prefer a remote database.
- Runs a bundled Redis plus [serverless-redis-http](https://github.com/hiett/serverless-redis-http) (SRH), which exposes Redis over the Upstash REST API the app uses. This enables the profile/store cache and auth rate limiting without an Upstash account. Neither is published outside the Docker network. Set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` in `.env` to use hosted Upstash instead.
- Publishes the port on `127.0.0.1` only. To expose it on a LAN or the internet, put a TLS reverse proxy in front of it. Production session cookies are marked `Secure`, so browsers only send them over HTTPS (plain `http://localhost` also works). Minimal Caddy example:

  ```caddyfile
  store.example.com {
      reverse_proxy 127.0.0.1:3000
  }
  ```

  With a proxy in front, set `TRUSTED_PROXY_HOPS=1` in `.env` so the auth rate limiter buckets by the real client IP — see [Rate limiting behind a reverse proxy](#rate-limiting-behind-a-reverse-proxy).

- Refuses to start if `SESSION_SECRET`, `ENCRYPTION_KEY` or `SRH_TOKEN` is missing, so cookies are never written to disk unencrypted.

**Prebuilt image:** every push to `main` publishes a multi-arch image (`linux/amd64`, `linux/arm64`) to GitHub Container Registry, and version tags (`v1.2.3`) publish `:1.2.3` / `:1.2`. To use it instead of building locally, create a `docker-compose.override.yml` next to `docker-compose.yml`:

```yaml
services:
  app:
    image: ghcr.io/yugam23/valorant-store-checker:latest
    pull_policy: always
```

Then start with `docker compose up -d` (without `--build`).

> **Tip:** the same setup works as a production-like local environment on your own machine — `docker compose up -d --build` gives you the app plus Redis, so caching and rate limiting behave the same as on a hosted deployment. Use `docker compose logs -f app` to follow the server logs (set `LOG_LEVEL=info` or `debug` in `.env` for more detail) and `docker compose down` to stop it.

> **Note:** the "Launch Riot Login" button opens the Riot login page in a new tab of _your own_ browser (client-side `window.open`); the server never launches a browser. Log in there and paste the redirect URL / cookies back into the form, or use the credentials + MFA login.

### Turso Database (Optional but Recommended)

Without a persistent Turso database, sessions are stored in a local SQLite file that is ephemeral on Vercel (wiped on each deployment). The easiest way on Vercel is the Turso integration in the **Storage** tab (see the note about database branches above). To set it up manually instead:

1. Create a free database at [turso.tech](https://turso.tech):
   ```bash
   turso db create valorant-store-checker
   turso db tokens create valorant-store-checker
   ```
2. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to your Vercel environment variables.

---

## Local Development

### Prerequisites

- Node.js 20+
- pnpm (the versions are pinned in `mise.toml`)

### Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/yugam23/Valorant-Store-Checker.git
   cd Valorant-Store-Checker
   ```

2. **Install dependencies:**

   ```bash
   pnpm install
   ```

3. **Create `.env.local`:**

   ```env
   SESSION_SECRET=your-dev-secret-min-32-chars-long
   ENCRYPTION_KEY=your-64-char-hex-key-here
   HENRIK_API_KEY=your-henrikdev-api-key
   ```

4. **Start the development server:**

   ```bash
   pnpm dev
   ```

5. Open [http://localhost:3000](http://localhost:3000).

`pnpm dev` runs without Redis unless you set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, so every page load goes straight to Riot and HenrikDev. To test with caching and rate limiting, use the [Docker setup](#option-2-self-host-with-docker) instead.

### Running Tests

```bash
pnpm test              # run all tests
pnpm test:coverage     # run with coverage report
```

The test suite uses Vitest + MSW v2 for API mocking. Coverage thresholds are strictly enforced.

### End-to-End Tests

```bash
pnpm test:e2e          # Playwright — starts its own mocked server
```

`pnpm test` does **not** run `e2e/`. The end-to-end suite is a separate
Playwright run with its own CI job (`E2E` in `.github/workflows/ci.yml`), so a
break there shows up on the pull request rather than sitting unnoticed.

Playwright starts the server itself with `pnpm dev:e2e`, which is `next dev`
plus `node --import src/lib/msw/start.ts`. That `--import` is what installs the
MSW mock server — **plain `next dev` does not mock anything**, so every Riot
call would go to the real API and the login would fail with a 401.

**The suite does not use port 3000, and does not reuse a running server.** Port
3000 is a popular default: a Grafana container, another dev server or any
unrelated service listening there answers `200` on both `/` and `/login`. With
`reuseExistingServer` a suite pointed at 3000 happily runs against that
stranger, and the failures make no sense (or, worse, a few assertions pass by
accident). `playwright.config.ts` therefore uses port `3101` (override with
`E2E_PORT`) and `reuseExistingServer: false`, so an occupied port is a loud
error instead of a silent wrong target:

```
Error: http://localhost:3101/login is already used, make sure that nothing is
running on the port/url or set reuseExistingServer:true in config.webServer.
```

A `curl` returning 200 is not proof the app is up. Check the `[WebServer]` lines
in the Playwright output for `▲ Next.js` and `[MSW] Node server started`.

Two more things the config takes care of, worth knowing when a run misbehaves:

- **The suite never writes to your database.** MSW only intercepts HTTP, and
  `.env.local` may point `TURSO_DATABASE_URL` at a real hosted database — the
  wishlist test writes, so the run would edit it for real. `webServer.env`
  therefore blanks that variable and sets `SESSION_DB_PATH=.session-data/e2e.db`,
  a throwaway local SQLite file.
- **Stop your own `pnpm dev` first.** `next dev` refuses to start a second dev
  server for the same directory (`⨯ Another next dev server is already
  running.`), and Playwright reports it only as
  `Process from config.webServer was not able to start. Exit code: 1`.

### Mutation Testing

```bash
pnpm mutation          # Stryker — reports/mutation/index.html
```

Coverage tells you which lines ran; mutation testing tells you whether the tests
would have *noticed* a change. It runs over the same files the coverage config
includes (`src/lib`, `src/app/api`, `src/middleware.ts`).

A full run takes about 2.5 minutes. Scope it while working on one area:

```bash
pnpm mutation --mutate "src/lib/session*.ts"
```

Nothing fails the build on mutation score yet (`thresholds.break` is `null`) —
we're still establishing a baseline. The CI job uploads the HTML report as the
`mutation-report` artifact.

**Vitest is pinned to 4.x on purpose.** `@stryker-mutator/vitest-runner@10` does
not work with Vitest 5: every mutant survives with `Ran 0.00 tests per mutant`,
and debug logging crashes reading `ctx.config`. The fallback (Stryker's `command`
runner, one full Vitest process per mutant) is correct but takes ~2.5 hours on a
laptop and over 5 on a CI runner. Don't bump Vitest to 5 until the runner
supports it — check <https://github.com/stryker-mutator/stryker-js/releases>.

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Home / landing
│   ├── login/                # Auth flow (credential entry + MFA)
│   ├── store/                # Daily store, Night Market, bundles (protected)
│   ├── profile/              # Rank, level, identity (protected)
│   ├── inventory/            # Owned cosmetics (protected)
│   ├── history/              # Store rotation history (protected)
│   └── api/
│       ├── auth/             # Multi-step Riot OAuth dispatcher
│       ├── profile/          # Identity + rank
│       ├── inventory/        # Cosmetics
│       ├── wishlist/         # Bookmark management
│       └── accounts/         # Multi-account list + switch
├── components/
│   ├── store/                # StoreCard, StoreGrid, DailyStore, Bundle, NightMarket, Wallet
│   ├── profile/              # PlayerCardBanner, RankDisplay, RRProgressBar, AccountLevelBadge
│   ├── layout/               # Header, MobileNav, AccountSwitcher
│   └── ui/                   # Button, LoadingSkeleton, SectionErrorBoundary
└── lib/
    ├── auth-handlers/        # credentials, mfa, url, cookie, shared
    ├── schemas/              # Zod schemas (session, riot-auth, storefront, henrik)
    ├── __tests__/            # 101 Vitest tests across 8 files
    ├── session.ts            # getCachedSession (RSC-safe)
    ├── session-store.ts      # Transparent encrypt/decrypt layer
    ├── session-crypto.ts     # AES-256-GCM primitives
    ├── session-db.ts         # LibSQL client + migrations
    ├── api-validate.ts       # parseBody<T> + withSession HOF
    ├── riot-auth.ts          # Riot OAuth + MFA + SSID refresh
    ├── riot-store.ts         # Storefront API + shard selection
    ├── riot-loadout.ts       # Player loadout (card, title, level)
    ├── redis-client.ts       # Upstash Redis client (REST)
    ├── rate-limiter.ts       # Auth rate limiting (Upstash Ratelimit)
    ├── store-cache.ts        # Store cache (Redis)
    ├── profile-cache.ts      # Profile cache (Redis, 6h)
    ├── riot-tokens.ts        # Token + entitlements extraction
    ├── riot-inventory.ts     # Owned cosmetics
    └── valorant-api.ts       # HenrikDev integration (rank, skins metadata)
```

---

## Security

This project is designed with security as a first-class concern:

- **HTTP-only cookies** — session tokens are never accessible to JavaScript
- **Server-side token storage** — Riot access tokens and cookies never reach the client
- **AES-256-GCM encryption** — all Riot cookies are encrypted at rest in the database
- **Reference-token sessions** — JWTs contain only a session ID, not the session payload
- **Zod input validation** — all API routes reject malformed requests early with 400 responses
- **CSP headers** — strict Content Security Policy with no inline scripts in production
- **HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy** — full security header suite
- **Automatic token refresh** — SSID-based refresh at 55 minutes; sessions invalidated at 65 minutes
- **Session cleanup** — expired sessions purged from the database hourly

> **Disclaimer:** This project is not affiliated with Riot Games. Usage is subject to Riot's Terms of Service. Credentials are only used to authenticate directly with Riot's servers — they are never stored or logged.

---

## License

This project is open source. See [LICENSE](LICENSE) for details.
