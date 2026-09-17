/**
 * Environment Variable Validation
 *
 * Validates required environment variables at import time.
 * Throws at build / startup if any required variable is missing,
 * preventing silent failures at runtime.
 *
 * Usage:
 *   import { env } from "@/lib/env";
 *   const secret = env.SESSION_SECRET; // guaranteed to be a string
 */

function requiredInProduction(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value) return value;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `❌ Missing required environment variable: ${key}. ` +
      `Set it in your environment or .env file before deploying.`
    );
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(
    `❌ Missing required environment variable: ${key}. ` +
    `Set it in your .env.local file for development.`
  );
}

/**
 * Validated environment configuration.
 * Import this instead of reading process.env directly.
 */
/**
 * Reads TRUSTED_PROXY_HOPS, defaulting to 1 when unset or unparseable.
 * An explicit 0 is preserved, so it cannot be confused with "not set".
 */
function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === "") return 1;
  const parsed = Math.trunc(Number(raw));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 1;
}

export const env = {
  /** Secret key for encrypting session JWTs. Must be set in production. */
  SESSION_SECRET: requiredInProduction("SESSION_SECRET", "dev-only-insecure-secret"),

  /** Current runtime environment */
  NODE_ENV: (process.env.NODE_ENV ?? "development") as "development" | "production" | "test",

  /** Optional: override the minimum log level (debug | info | warn | error) */
  LOG_LEVEL: process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error" | undefined,

  /** Optional: Henrik API key for rank/level data. Profile degrades gracefully without it. */
  HENRIK_API_KEY: process.env.HENRIK_API_KEY ?? "",

  /** Optional: path to SQLite session database file (relative to cwd). Falls back to .session-data/sessions.db */
  SESSION_DB_PATH: process.env.SESSION_DB_PATH,

  /** Optional: 64-char hex string (32 bytes). Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   *  When set, riotCookies are encrypted at rest using AES-256-GCM before being written to SQLite.
   *  When absent, cookies are stored as plaintext and a one-time warning is logged.
   */
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY as string | undefined,

  /** Optional: Upstash Redis REST URL for serverless cache persistence.
   *  Get from: Upstash Dashboard -> Redis -> Overview -> REST URL
   *  Falls back to KV_REST_API_URL (Vercel Marketplace Upstash integration).
   */
  UPSTASH_REDIS_REST_URL: (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) as string | undefined,

  /** Optional: Upstash Redis REST Token for serverless cache persistence.
   *  Get from: Upstash Dashboard -> Redis -> Overview -> REST Token
   *  Falls back to KV_REST_API_TOKEN (Vercel Marketplace Upstash integration).
   */
  UPSTASH_REDIS_REST_TOKEN: (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN) as string | undefined,

  /** Optional: Maximum auth requests per minute per IP for rate limiting.
   *  Defaults to 10 if not set.
   */
  RATE_LIMIT_REQS_PER_MIN: Number(process.env.RATE_LIMIT_REQS_PER_MIN) || 10,

  /** Optional: Number of reverse proxies in front of the app that append to
   *  X-Forwarded-For. The rate limiter reads the client IP that many hops from
   *  the right of the header, so a client-supplied prefix cannot pick its own
   *  bucket. Defaults to 1 — the hop the closest proxy appended, which is also
   *  what Next fills in from the socket when no proxy is present.
   *  Set to 0 to ignore forwarded IP headers entirely (every caller then
   *  shares one bucket).
   */
  TRUSTED_PROXY_HOPS: trustedProxyHops(),
} as const;
