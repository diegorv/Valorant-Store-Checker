/**
 * Next.js Instrumentation - ENCRYPTION_KEY and Redis validation at server startup.
 *
 * This register() function runs AFTER next build completes, NOT during build.
 * This is the ONLY safe place for production env validation that must not
 * run during `next build`.
 *
 * - Development/Test: does nothing (session-store.ts handles the key fallback with
 *   a warning, rate-limiter.ts warns on every unlimited request)
 * - Every other environment: throws if the key is missing or invalid, or if Redis
 *   was never configured
 */

export async function register() {
  // Allowlist, not denylist: staging, preview and an unset NODE_ENV must fail
  // closed rather than inherit the development fallback.
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== "development" && nodeEnv !== "test") {
    const key = process.env.ENCRYPTION_KEY;

    if (!key) {
      throw new Error(
        "ENCRYPTION_KEY environment variable is required outside development and test.\n" +
        "Generate a valid key with:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
        "Then set it in your environment or .env file."
      );
    }

    if (!/^[0-9a-f]{64}$/i.test(key)) {
      throw new Error(
        "ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).\n" +
        "Generate a valid key with:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }

    // "Never configured" — no Redis credentials at all. The auth rate limiter
    // then has no backing store and every login attempt passes, so a deployment
    // others can reach must not come up. This is NOT the same as a configured
    // deployment whose Redis is momentarily unreachable: that one is handled per
    // request in lib/rate-limiter.ts and still fails open on purpose.
    // Asserts on the client itself rather than re-reading the credentials, so it
    // can never disagree with the value rate-limiter.ts branches on. Imported
    // here, not at module scope, so development and test never build a client
    // just to skip this check.
    const { redis } = await import("@/lib/redis-client");

    if (!redis) {
      throw new Error(
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required outside development and test.\n" +
        "Without them the auth endpoints accept unlimited login attempts.\n" +
        "Add Upstash Redis from the Vercel Marketplace (it injects KV_REST_API_URL /\n" +
        "KV_REST_API_TOKEN, which are accepted too), or point these at any Upstash-REST\n" +
        "compatible server — docker-compose.yml ships one."
      );
    }
  }

  // NOTE: MSW initialization has been moved to lib/msw/start.ts which is
  // invoked via `node --import` at runtime (see package.json scripts).
  // This avoids Turbopack analyzing MSW's Node.js-only internals during build.
}