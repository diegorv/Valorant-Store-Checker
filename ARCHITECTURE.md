# Architecture

How Valorant Store Checker is built: the stack, the request flow and the patterns the code relies on. For running it see [HOSTING.md](HOSTING.md), for working on it see [DEVELOPMENT.md](DEVELOPMENT.md); the project overview is in the [README](README.md).

- [Tech Stack](#tech-stack)
- [Overview](#overview)
- [Key patterns](#key-patterns)
- [Authentication](#authentication)
- [Security](#security)

---

## Tech Stack

| Category          | Technology                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| **Framework**     | [Next.js 16](https://nextjs.org) (App Router, Server Components)                                        |
| **Language**      | [TypeScript 6](https://www.typescriptlang.org) (strict + `noUncheckedIndexedAccess`)                    |
| **Styling**       | [Tailwind CSS v4](https://tailwindcss.com)                                                              |
| **UI Primitives** | [Radix UI](https://www.radix-ui.com), [Lucide Icons](https://lucide.dev), [CVA](https://cva.style)      |
| **Validation**    | [Zod 4](https://zod.dev)                                                                                |
| **Server DB**     | [LibSQL / Turso](https://turso.tech) (SQLite)                                                           |
| **Cache**         | [Upstash Redis](https://upstash.com) (REST) — or bundled Redis + [SRH](https://github.com/hiett/serverless-redis-http) in Docker |
| **Client DB**     | [Dexie.js](https://dexie.org) (IndexedDB — store history)                                               |
| **PDF Export**    | [jspdf](https://github.com/parallax/jsPDF) & [html2canvas-pro](https://github.com/niklasvh/html2canvas) |
| **Unit Tests**    | [Vitest](https://vitest.dev) + [MSW v2](https://mswjs.io), [Stryker](https://stryker-mutator.io) for mutation testing |
| **E2E Tests**     | [Playwright](https://playwright.dev) against an MSW-mocked server                                       |

---

## Overview

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
│  ├── actions/auth    ← login form (server action)    │
│  ├── /api/auth       ← multi-step Riot OAuth         │
│  ├── /api/profile    ← rank + identity               │
│  ├── /api/inventory  ← owned weapon skins            │
│  ├── /api/wishlist   ← bookmark management           │
│  └── /api/accounts   ← multi-account switching       │
│                                                      │
│  Session Layer                                       │
│  ├── session-store.ts   (encrypt-on-write / decrypt) │
│  ├── session-crypto.ts  (AES-256-GCM)                │
│  └── session-db.ts      (LibSQL + hourly cleanup)    │
│                                                      │
│  Riot Module                                         │
│  ├── riot-auth.ts       (OAuth + MFA)                │
│  ├── riot-reauth.ts     (SSID token refresh)         │
│  ├── riot-store.ts      (daily / night market / bundles) │
│  ├── riot-tokens.ts     (entitlements extraction)    │
│  └── riot-inventory.ts  (owned weapon skins)         │
└──────────────────────┬──────────────────────────────┘
                       │
         ┌─────────────┼──────────────┐
         ▼             ▼              ▼
  LibSQL / Turso   Redis (REST)   Riot + HenrikDev APIs
  (encrypted       (cache +       (auth, store, loadout,
   sessions)        rate limit)    rank)
```

## Key patterns

- **Reference-token sessions** — JWT in cookie carries only a session ID; all data stays in SQLite
- **RSC deduplication** — `React.cache()` wraps `getSession()` to deduplicate DB reads per render pass
- **withSession HOF** — all protected API routes wrapped with `withSession(handler)` for zero-boilerplate auth
- **Redis-backed caches** — store (until the next rotation), profile (6 hours) and Valorant catalog data (24 hours) are cached in Redis, so page reloads don't re-hit Riot or HenrikDev; inventory is cached in memory. Without Redis the app still works, just without these caches
- **Auth rate limiting** — sliding-window limit on login attempts per IP, backed by Redis (fails open when Redis is not configured)
- **Shard memoization** — the first Riot PD request tries the session's shard alone and remembers the one that works, instead of probing every shard
- **Section-level error boundaries** — each store section fails independently; the rest of the page renders

---

## Authentication

- **Web form** (`components/auth/LoginForm.tsx` → server action `actions/auth.ts`): the user logs in on Riot's page and pastes back either the redirect URL (`https://playvalorant.com/opt_in#access_token=…&id_token=…`) or a Riot cookie string (`ssid`, `clid`, `csid`, `tdid`). The password never reaches this app.
- **`POST /api/auth`** accepts the same two payloads (`url`, `cookie`) plus `auth` (username/password) and `multifactor` (MFA code) for external clients. Handlers live in `lib/auth-handlers/`.
- **Session** = a 30-day row in LibSQL holding the Riot tokens, plus an HTTP-only cookie carrying a signed JWT with nothing but the row's ID. Riot cookies in the row are encrypted with `ENCRYPTION_KEY` (AES-256-GCM).
- **Token lifecycle**: Riot access tokens last about an hour. `getSessionWithRefresh()` re-authenticates with the stored `ssid` once the token is 55 minutes old; if that fails (or there are no cookies to refresh with) the stale token is still returned until 65 minutes, then the session is deleted and the user is sent to the login form. URL sign-in stores no Riot cookies, so it cannot refresh and ends after about an hour; cookie sign-in refreshes for up to 30 days (Riot's `ssid` lifetime).
- **Logout** (`POST /api/auth/logout`) deletes the session row, evicts it from the in-memory cache and clears the cookie. Riot's own cookies are not revoked.

---

## Security

This project is designed with security as a first-class concern:

- **HTTP-only cookies** — session tokens are never accessible to JavaScript
- **Server-side token storage** — Riot access tokens and cookies never reach the client
- **AES-256-GCM encryption** — all Riot cookies are encrypted at rest in the database
- **Reference-token sessions** — JWTs contain only a session ID, not the session payload
- **Zod input validation** — all API routes reject malformed requests early with 400 responses
- **CSP headers** — Content Security Policy that limits images and media to valorant-api.com, blocks framing and plugins, restricts forms to the app itself and upgrades insecure requests. Inline scripts stay allowed (Next.js hydration needs them), so it is not a nonce-based CSP
- **HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy** — full security header suite
- **Session cleanup** — expired sessions purged from the database hourly
