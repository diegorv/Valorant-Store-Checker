/**
 * Upstash Rate Limiter Singleton
 *
 * Provides a global-singleton Ratelimit instance for Next.js hot-reload safety.
 * Uses sliding window algorithm with Redis as the backing store.
 *
 * Two different situations let a request through unlimited, and they are kept apart:
 * - Redis was NEVER configured — only reachable in development and test, because
 *   instrumentation.ts refuses to start anywhere else without credentials.
 * - Redis IS configured but did not answer in time — a deliberate availability
 *   tradeoff, kept, because failing closed would turn any Redis hiccup into a
 *   total login outage.
 * Both warn on every request they let through.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "./redis-client";
import { env } from "./env";
import { createLogger } from "./logger";

const log = createLogger("Rate Limiter");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  pending: Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Global singleton (Next.js hot-reload safe)
// ---------------------------------------------------------------------------

declare global {
  var __authRatelimit: Ratelimit | undefined;
}

function getRatelimit(): Ratelimit {
  if (!global.__authRatelimit) {
    if (!redis) {
      throw new Error("Rate limiter requires Redis to be configured");
    }
    global.__authRatelimit = new Ratelimit({
      redis: redis,
      limiter: Ratelimit.slidingWindow(env.RATE_LIMIT_REQS_PER_MIN, "60 s"),
      analytics: false,
      timeout: 5000, // 5 second timeout for fail-open behavior
    });
  }
  return global.__authRatelimit;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// Lazy getter to avoid throwing at module load time when Redis is unavailable
export const authRatelimit = {
  limit: (ip: string) => getRatelimit().limit(ip),
};

export async function rateLimit(ip: string): Promise<RateLimitResult> {
  if (!redis) {
    // Redis was never configured. instrumentation.ts refuses to start outside
    // development and test, so this only ever serves local dev and CI — and it
    // says so on every request instead of once at boot.
    log.warn("Redis not configured — request served with no rate limiting");
    return {
      success: true,
      limit: 0,
      remaining: 0,
      reset: 0,
      pending: Promise.resolve(0),
    };
  }

  const result = await authRatelimit.limit(ip);
  if (result.reason === "timeout") {
    // Redis is configured but did not answer within the 5s timeout above, so
    // @upstash/ratelimit let the request through. Deliberate, but not silent.
    log.warn("Redis unreachable within 5s — request served with no rate limiting");
  }
  return result;
}
