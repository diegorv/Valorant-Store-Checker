# Hosting

Two ways to run Valorant Store Checker. For working on the code see [DEVELOPMENT.md](DEVELOPMENT.md); the project overview and architecture are in the [README](README.md).

| | Option 1: Self-host with Docker | Option 2: Deploy to Vercel |
| --- | --- | --- |
| Where it runs | Your own server (VPS, home lab, NAS) | Vercel's serverless platform |
| Where your Riot session lives | On your machine, in an encrypted SQLite volume | In a Turso database you attach |
| Cache and rate limiting | Bundled Redis, no account needed | Upstash Redis from the Vercel Marketplace |
| Setup | Two files and `docker compose up -d` | One click plus a few environment variables |

- [Option 1: Self-host with Docker](#option-1-self-host-with-docker)
  - [Run the prebuilt image](#run-the-prebuilt-image-recommended)
  - [Build from source](#build-from-source)
- [Option 2: Deploy to Vercel](#option-2-deploy-to-vercel)
  - [Turso database](#turso-database)
- [Environment Variables](#environment-variables)
  - [Rate limiting behind a reverse proxy](#rate-limiting-behind-a-reverse-proxy)

---

## Option 1: Self-host with Docker

Run the app on your own server (VPS, home lab, NAS). Your Riot session cookies never leave infrastructure you control, and everything the app needs (Redis included) comes up with one command.

### Run the prebuilt image (recommended)

Every push to `main` publishes a multi-arch image (`linux/amd64`, `linux/arm64`) to [GitHub Container Registry](https://github.com/diegorv/Valorant-Store-Checker/pkgs/container/valorant-store-checker). You need two files and no checkout:

1. **Get the compose file and the env template:**

   ```bash
   mkdir valorant-store-checker && cd valorant-store-checker
   curl -fsSLO https://raw.githubusercontent.com/diegorv/Valorant-Store-Checker/main/docker-compose.yml
   curl -fsSL  https://raw.githubusercontent.com/diegorv/Valorant-Store-Checker/main/.env.example -o .env
   ```

2. **Generate the three secrets** and paste them into `.env`:

   ```bash
   openssl rand -base64 32   # SESSION_SECRET
   openssl rand -hex 32      # ENCRYPTION_KEY (must be 64 hex chars)
   openssl rand -hex 32      # SRH_TOKEN (bundled Redis REST proxy)
   ```

3. **Start:**

   ```bash
   docker compose up -d
   ```

4. Open [http://localhost:3000](http://localhost:3000). If port 3000 is taken, set `APP_PORT` in `.env`.

**Updating:** `docker compose pull && docker compose up -d` fetches the newest `main` build and restarts the app; sessions live in a volume and survive it.

**Choosing a build:** the default is `ghcr.io/diegorv/valorant-store-checker:latest`, the latest commit on `main`. Every commit on `main` also gets a `sha-<short commit>` tag, so you can pin an exact build with `APP_IMAGE=ghcr.io/diegorv/valorant-store-checker:sha-<short commit>` in `.env`. Version tags (`v1.2.3` → `:1.2.3` and `:1.2`) are published whenever a release is tagged.

### Build from source

Same setup, but the image is built from your checkout. Useful when you have local changes or do not want to run a prebuilt binary.

1. **Clone and configure:**

   ```bash
   git clone https://github.com/diegorv/Valorant-Store-Checker.git
   cd Valorant-Store-Checker
   cp .env.example .env
   ```

2. **Generate the three secrets** as above and paste them into `.env`.

3. **Build and start**, adding `docker-compose.build.yml` on top of the base file:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
   ```

   To make that the default, add `COMPOSE_FILE=docker-compose.yml:docker-compose.build.yml` to `.env`; plain `docker compose up -d --build` then builds from source.

### What the Docker setup does

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

> **Tip:** the same setup works as a production-like local environment on your own machine — either path gives you the app plus Redis, so caching and rate limiting behave the same as on a hosted deployment. Use `docker compose logs -f app` to follow the server logs (set `LOG_LEVEL=info` or `debug` in `.env` for more detail) and `docker compose down` to stop it.

> **Note:** the "Launch Riot Login" button opens the Riot login page in a new tab of _your own_ browser (client-side `window.open`); the server never launches a browser. Log in there and paste the redirect URL / cookies back into the form.

---

## Option 2: Deploy to Vercel

1. Click [**Deploy with Vercel**](https://vercel.com/new/clone?repository-url=https://github.com/diegorv/Valorant-Store-Checker), or import the repo at [vercel.com/new](https://vercel.com/new).
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

### Turso database

Without a persistent Turso database, sessions are stored in a local SQLite file that is ephemeral on Vercel (wiped on each deployment). The easiest way on Vercel is the Turso integration in the **Storage** tab (see the note about database branches above). To set it up manually instead:

1. Create a free database at [turso.tech](https://turso.tech):
   ```bash
   turso db create valorant-store-checker
   turso db tokens create valorant-store-checker
   ```
2. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to your Vercel environment variables.

---

## Environment Variables

Reference for every variable the app reads. `.env.example` at the repository root lists the same variables with comments and is the file the Docker setup starts from.

### Required

| Variable         | Description                                                                        |
| ---------------- | ---------------------------------------------------------------------------------- |
| `SESSION_SECRET` | Secret for signing session JWTs. Min 32 chars. Generate: `openssl rand -base64 32` |

### Recommended

| Variable         | Description                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ENCRYPTION_KEY` | AES-256-GCM key for encrypting Riot cookies at rest. **Must be 64 hex chars (32 bytes).** Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `HENRIK_API_KEY` | [HenrikDev API](https://docs.henrikdev.xyz) key for rank and level data. The app degrades gracefully without it.                                                               |
| `LOG_LEVEL`      | Minimum log level: `debug`, `info`, `warn` or `error` (default: `warn` in production)                                                                                          |

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
| `APP_PORT`                 | **Docker only.** Host port the app is published on (default: `3000`)                                                                         |

> **Important:** Without `ENCRYPTION_KEY`, Riot session cookies are stored in plaintext in the database. Setting this variable is strongly recommended for any deployment accessible to others.

### Rate limiting behind a reverse proxy

The auth rate limiter buckets attempts per client IP, which it reads from `X-Forwarded-For`. Clients can send that header themselves, so the app only trusts the hops a proxy you control appended: each proxy appends the address it saw, and `TRUSTED_PROXY_HOPS` says how many entries to count from the **right** of the list.

| Deployment                                       | `TRUSTED_PROXY_HOPS` |
| ------------------------------------------------ | -------------------- |
| One reverse proxy (the Caddy example in [Option 1](#option-1-self-host-with-docker), nginx) | `1` (default) |
| CDN in front of your own proxy (e.g. Cloudflare → Caddy) | `2`            |
| Ignore forwarded headers entirely                 | `0`                  |

The default `1` reads the rightmost entry, which only your proxy can write — and when no proxy is present, Next fills that entry in from the socket, so each caller still gets its own bucket. Exposing the app directly with no proxy in front is the one case the default does not cover: there the caller can supply the header itself, so put a proxy in front before exposing it. A request that arrives with fewer hops than you configured (someone reaching your origin past the CDN, say) shares the fallback bucket rather than falling back to a header the caller controls. Setting `0` ignores forwarded headers entirely: nothing is forgeable, but every caller shares one bucket.
