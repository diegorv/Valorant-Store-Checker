<p align="center">
  <img src="public/icons/Valorant_Store_Checker.webp" width="750" alt="Valorant Store Checker">
</p>

<h1 align="center">Valorant Store Checker</h1>

<p align="center">
  Check your daily Valorant store, Night Market, and bundles — without launching the game.
</p>

<p align="center">
  <a href="https://github.com/diegorv/Valorant-Store-Checker/actions/workflows/ci.yml">
    <img src="https://github.com/diegorv/Valorant-Store-Checker/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI">
  </a>
  <a href="https://vercel.com/new/clone?repository-url=https://github.com/diegorv/Valorant-Store-Checker">
    <img src="https://vercel.com/button" alt="Deploy with Vercel">
  </a>
</p>

> **This repository is a fork.** Valorant Store Checker was created by [Yugam](https://github.com/yugam23) at [yugam23/Valorant-Store-Checker](https://github.com/yugam23/Valorant-Store-Checker). This fork is now developed independently: it does not open pull requests against the original repository, does not track it, and the two projects are expected to diverge over time. See [Credits](#credits).

---

## Overview

Valorant Store Checker is a production-grade, security-hardened Next.js application that authenticates with Riot's OAuth flow and surfaces your personalized in-game store. You sign in by pasting the Riot redirect URL or your Riot cookies into the form; the API additionally accepts username/password with MFA for external clients. It supports multi-account switching, store rotation history, wishlists, inventory browsing, a skin encyclopedia, and full profile/rank display — all without ever opening the Valorant client.

Sessions are encrypted at rest using AES-256-GCM, tokens never leave the server, and all Riot cookies are stored server-side only. The project ships with a comprehensive Vitest test suite and can be self-hosted on Vercel or with Docker.

---

## Getting Started

- **Host it yourself** → [HOSTING.md](HOSTING.md): environment variables, one-click Vercel deploy, Docker Compose setup and Turso.
- **Work on the code** → [DEVELOPMENT.md](DEVELOPMENT.md): local setup, the unit, end-to-end and mutation test suites, and the project layout.

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
| **Encyclopedia**   | Browse every weapon skin in the game, filterable by weapon and tier (`/encyclopedia`)      |
| **Multi-Account**  | Link and switch between multiple Riot accounts in one session                              |
| **Sign-in**        | Paste the Riot redirect URL or your Riot cookies; cookie sign-in refreshes itself for up to 30 days |
| **API auth**       | `POST /api/auth` also accepts username/password with MFA, for external clients             |

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

**Key patterns:**

- **Reference-token sessions** — JWT in cookie carries only a session ID; all data stays in SQLite
- **RSC deduplication** — `React.cache()` wraps `getSession()` to deduplicate DB reads per render pass
- **withSession HOF** — all protected API routes wrapped with `withSession(handler)` for zero-boilerplate auth
- **Redis-backed caches** — store (until the next rotation), profile (6 hours) and Valorant catalog data (24 hours) are cached in Redis, so page reloads don't re-hit Riot or HenrikDev; inventory is cached in memory. Without Redis the app still works, just without these caches
- **Auth rate limiting** — sliding-window limit on login attempts per IP, backed by Redis (fails open when Redis is not configured)
- **Shard memoization** — the first Riot PD request tries the session's shard alone and remembers the one that works, instead of probing every shard
- **Section-level error boundaries** — each store section fails independently; the rest of the page renders

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
- **Automatic token refresh** — SSID-based refresh at 55 minutes; sessions invalidated at 65 minutes
- **Session cleanup** — expired sessions purged from the database hourly

> **Disclaimer:** This project is not affiliated with Riot Games. Usage is subject to Riot's Terms of Service. Credentials are only used to authenticate directly with Riot's servers — they are never stored or logged.

---

## Credits

This project is a fork of [yugam23/Valorant-Store-Checker](https://github.com/yugam23/Valorant-Store-Checker), created by [Yugam](https://github.com/yugam23). The original idea, design, architecture and the bulk of the feature set are their work. Thank you.

The fork is maintained separately by [diegorv](https://github.com/diegorv) and follows its own direction:

- Changes made here are **not** submitted upstream as pull requests, and upstream changes are not merged back automatically.
- Bugs and feature requests about this fork belong in [this repository's issues](https://github.com/diegorv/Valorant-Store-Checker/issues). Anything about the original project belongs in the [original repository](https://github.com/yugam23/Valorant-Store-Checker/issues).

---

## License

The original repository does not ship a license file, and neither does this fork. Until one is added, the code is covered only by GitHub's default terms: you may view and fork it, but no other rights are granted. Copyright in the original work remains with its author (see [Credits](#credits)).
