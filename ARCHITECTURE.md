# Architecture

How Valorant Store Checker is built: the stack, the request flow and the patterns the code relies on. For running it see [HOSTING.md](HOSTING.md), for working on it see [DEVELOPMENT.md](DEVELOPMENT.md); the project overview is in the [README](README.md).

- [Tech Stack](#tech-stack)
- [Overview](#overview)
- [Key patterns](#key-patterns)

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
│  ├── riot-auth.ts       (OAuth + MFA)                │
│  ├── riot-reauth.ts     (SSID token refresh)         │
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

## Key patterns

- **Reference-token sessions** — JWT in cookie carries only a session ID; all data stays in SQLite
- **RSC deduplication** — `React.cache()` wraps `getSession()` to deduplicate DB reads per render pass
- **withSession HOF** — all protected API routes wrapped with `withSession(handler)` for zero-boilerplate auth
- **Redis-backed caches** — store (until the next rotation), profile (6 hours) and Valorant catalog data (24 hours) are cached in Redis, so page reloads don't re-hit Riot or HenrikDev; inventory is cached in memory. Without Redis the app still works, just without these caches
- **Auth rate limiting** — sliding-window limit on login attempts per IP, backed by Redis (fails open when Redis is not configured)
- **Shard memoization** — the first Riot PD request tries the session's shard alone and remembers the one that works, instead of probing every shard
- **Section-level error boundaries** — each store section fails independently; the rest of the page renders
