/**
 * Next.js Instrumentation - ENCRYPTION_KEY validation at server startup.
 *
 * This register() function runs AFTER next build completes, NOT during build.
 * This is the ONLY safe place for production env validation that must not
 * run during `next build`.
 *
 * - Development/Test: does nothing (session-store.ts handles fallback with warning)
 * - Every other environment: throws if key missing or invalid
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
  }

  // NOTE: MSW initialization has been moved to lib/msw/start.ts which is
  // invoked via `node --import` at runtime (see package.json scripts).
  // This avoids Turbopack analyzing MSW's Node.js-only internals during build.
}