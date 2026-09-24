/**
 * Structured Logger Utility
 *
 * Provides consistent, filterable logging across the application.
 * Each logger instance is tagged with a context label (e.g., "riot-auth", "riot-store").
 *
 * Log levels: debug < info < warn < error
 * - In development and test, all levels are active.
 * - Everywhere else, only warn/error are emitted by default.
 *
 * Usage:
 *   import { createLogger } from "@/lib/logger";
 *   const log = createLogger("riot-auth");
 *   log.info("Step 1 - Init status:", status);
 *   log.warn("Shard failed", { region, status: 404 });
 *   log.error("Fatal failure", error);
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Minimum log level threshold.
 * - development / test → "debug" (everything is emitted)
 * - anything else      → "warn"  (only warn + error are emitted)
 *
 * Override via LOG_LEVEL env var if needed.
 */
function getMinLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  if (envLevel && envLevel in LOG_LEVELS) return envLevel;
  // Allowlist, not denylist: anything that is not explicitly development or
  // test must not default to debug — that is the level that puts token and
  // cookie material in the logs. Next inlines `process.env.NODE_ENV` at build
  // time, so in a built app this is hardening at the source. Read from
  // process.env, never from the env module: the test suite mocks that module,
  // and a mocked guard is no guard.
  const nodeEnv = process.env.NODE_ENV;
  return nodeEnv === "development" || nodeEnv === "test" ? "debug" : "warn";
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Creates a logger scoped to the given context tag.
 * @param context A short identifier, e.g. "riot-auth", "Store API"
 * @param reqId Optional request ID (UUID) — first 8 chars are prepended to every log line
 */
export function createLogger(context: string, reqId?: string): Logger {
  const minLevel = getMinLevel();
  const reqPrefix = reqId ? `[${reqId.substring(0, 8)}]` : "";
  const prefix = reqPrefix ? `[${context}] ${reqPrefix}` : `[${context}]`;

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
  }

  return {
    debug: (...args: unknown[]) => {
      if (shouldLog("debug")) console.debug(prefix, ...args);
    },
    info: (...args: unknown[]) => {
      if (shouldLog("info")) console.log(prefix, ...args);
    },
    warn: (...args: unknown[]) => {
      if (shouldLog("warn")) console.warn(prefix, ...args);
    },
    error: (...args: unknown[]) => {
      if (shouldLog("error")) console.error(prefix, ...args);
    },
  };
}
