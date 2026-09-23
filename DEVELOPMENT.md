# Development

Working on Valorant Store Checker locally. For deploying it see [HOSTING.md](HOSTING.md); the project overview and architecture are in the [README](README.md).

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running Tests](#running-tests)
- [End-to-End Tests](#end-to-end-tests)
- [Mutation Testing](#mutation-testing)
- [Project Structure](#project-structure)

---

## Prerequisites

- Node.js 22 and pnpm (both pinned in `mise.toml`; CI and the Docker image use the same versions)

## Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/diegorv/Valorant-Store-Checker.git
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

`pnpm dev` runs without Redis unless you set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, so every page load goes straight to Riot and HenrikDev. To test with caching and rate limiting, use the [Docker setup](HOSTING.md#option-1-self-host-with-docker) instead.

## Running Tests

```bash
pnpm test              # unit tests with coverage (same as CI)
pnpm test:watch        # watch mode
pnpm lint              # ESLint
pnpm typecheck         # tsc --noEmit
```

The unit suite uses Vitest + MSW v2 for API mocking. Coverage thresholds are enforced in `vitest.config.ts`, so a drop fails `pnpm test`.

## End-to-End Tests

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

## Mutation Testing

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

## Required checks

A red CI job does **not** block a merge on its own. GitHub only greys out the
merge button when a ruleset on `main` names a required status check, and the
repository shipped without one — PR #8 was merged while its `E2E` job was still
running, and the job then failed.

`ci.yml` has a `CI` job for this. It depends on `Build`, `Test` and `E2E`, runs
even when one of them failed or was cancelled (`if: always()`), and exits
non-zero unless all three succeeded. Requiring that single check covers the
whole pipeline and survives jobs being renamed or added. `Mutation testing` is
deliberately left out (see above).

To protect `main` (repository **Settings → Rules → Rulesets → New ruleset →
New branch ruleset**):

1. **Ruleset name:** `main`. **Enforcement status:** Active.
2. **Bypass list:** leave empty. Admins are *not* exempt unless listed here, so
   an empty list means the rules apply to your own pushes too.
3. **Target branches:** Add target → *Include default branch*.
4. Under **Rules**, tick:
   - *Restrict deletions* and *Block force pushes*.
   - *Require a pull request before merging*. Required approvals can stay `0`
     on a single-maintainer repository; the point is that every change lands
     through a PR, which is what runs and enforces the checks below.
   - *Require status checks to pass* → *Add checks* → search `CI` and pick the
     one whose source is GitHub Actions. Optionally also tick *Require branches
     to be up to date before merging*, so a PR is re-tested on the current
     `main` before it can merge.
5. **Create**.

The `CI` check only shows up in the *Add checks* search after it has run at
least once, so merge the workflow change first (or open a PR from a branch
that carries it) and then create the ruleset. Rulesets on private repositories
need a paid plan; on public ones they are free.

With the ruleset active, `git push origin main` is refused with
`GH013: Repository rule violations found`, and a PR whose `CI` check is red or
still running cannot be merged from the UI, the CLI or the API.

---

## Project Structure

```
src/
├── actions/
│   └── auth.ts               # Login server action (URL / cookie paste)
├── app/
│   ├── page.tsx              # Home / landing
│   ├── login/                # Sign-in form
│   ├── store/                # Daily store, Night Market, bundles (protected)
│   ├── profile/              # Rank, level, identity (protected)
│   ├── inventory/            # Owned weapon skins + PDF export (protected)
│   ├── history/              # Store rotation history (server-side, via /api/history)
│   ├── wishlist/             # Wishlist page
│   ├── encyclopedia/         # All weapon skins, filterable (public, revalidated hourly)
│   └── api/
│       ├── auth/             # Riot auth dispatcher (url, cookie, credentials, MFA) + logout
│       ├── profile/          # Identity + rank
│       ├── inventory/        # Owned weapon skins
│       ├── wishlist/         # Bookmark management
│       ├── accounts/         # Multi-account list + switch
│       └── history/          # Store rotation history: list, delete
├── components/
│   ├── auth/                 # LoginForm
│   ├── store/                # StoreCard, StoreGrid, DailyStore, Bundle, NightMarket, Wallet, LoadingSkeleton, SectionErrorBoundary
│   ├── profile/              # PlayerCardBanner, RankDisplay, RRProgressBar, AccountLevelBadge, IdentityInfo
│   ├── inventory/            # InventoryGrid, InventoryCard, PdfDownloadButton
│   ├── history/              # HistoryCard, HistoryStats
│   ├── wishlist/             # WishlistGrid, WishlistPanel
│   ├── encyclopedia/         # EncyclopediaClient, EncyclopediaGrid, EncyclopediaCard
│   ├── layout/               # Header, MobileNav, AccountSwitcher, WishlistButton
│   └── ui/                   # Button
├── hooks/                    # useWishlist, useCountdown
├── types/                    # Shared TypeScript types
├── middleware.ts             # Sends unauthenticated requests on protected routes to /login
└── lib/
    ├── auth-handlers/        # credentials, mfa, url, cookie, shared
    ├── schemas/              # Zod schemas (session, riot-auth, storefront, henrik, valorant-api, accounts)
    ├── msw/                  # Mocked Riot / HenrikDev server for the e2e suite
    ├── __tests__/            # Vitest unit tests (src/lib, API routes, middleware)
    ├── session.ts            # getSession / getSessionWithRefresh (RSC-safe)
    ├── session-store.ts      # Transparent encrypt/decrypt layer
    ├── session-crypto.ts     # AES-256-GCM primitives
    ├── session-db.ts         # LibSQL client + migrations
    ├── accounts.ts           # Multi-account registry
    ├── api-validate.ts       # parseBody<T> + withSession HOF
    ├── riot-auth.ts          # Riot OAuth + MFA
    ├── riot-reauth.ts        # SSID re-auth (token refresh)
    ├── riot-cookies.ts       # Riot cookie parsing / merging
    ├── riot-tokens.ts        # Token + entitlements extraction
    ├── riot-store.ts         # Storefront API + shard selection
    ├── riot-loadout.ts       # Player loadout (card, title, level)
    ├── riot-inventory.ts     # Owned weapon skins
    ├── store-service.ts      # Store page orchestration (storefront + catalog)
    ├── store-history-db.ts   # Store rotation history (LibSQL; written when /store renders)
    ├── profile-cache.ts      # Profile cache (Redis, 6h)
    ├── inventory-cache.ts    # Inventory cache (in-memory, 24h)
    ├── wishlist.ts           # Wishlist persistence (LibSQL)
    ├── valorant-api.ts       # Valorant-API catalog (skins, tiers; Redis, 24h)
    ├── henrik-api.ts         # HenrikDev integration (rank, level)
    ├── redis-client.ts       # Upstash Redis client (REST)
    ├── rate-limiter.ts       # Auth rate limiting (Upstash Ratelimit)
    ├── rate-limit-utils.ts   # Client IP resolution + rate-limit headers
    ├── logger.ts             # Structured logger (LOG_LEVEL)
    └── env.ts                # Validated environment variables
```
