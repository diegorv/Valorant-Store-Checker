/**
 * Rate Limit Utilities
 *
 * Helper functions for IP extraction, response headers, and rate-limited responses.
 */

import { NextRequest, NextResponse } from "next/server";
import { env } from "./env";

/**
 * Extracts the client IP from a Next.js request or headers object.
 *
 * Forwarded IP headers are only trusted when TRUSTED_PROXY_HOPS says how many
 * reverse proxies sit in front of the app. Each of them appends the address it
 * saw to x-forwarded-for, so the client IP is counted from the *right* of the
 * list — anything a client prepends itself is ignored. With no trusted proxy
 * (the default) every forwarded header is ignored and callers share the
 * 127.0.0.1 fallback bucket.
 */
export function getClientIP(requestOrHeaders: NextRequest | Headers): string {
  let headers: Headers;

  if (requestOrHeaders instanceof NextRequest) {
    headers = requestOrHeaders.headers;
  } else if (typeof requestOrHeaders.get === "function") {
    // Covers Headers and any duck-typed header-like object
    headers = requestOrHeaders;
  } else {
    // Defensive: headers is an unknown object — try to extract IPs via .get() or direct property access
    const asRecord = requestOrHeaders as unknown as Record<string, unknown>;
    const forwardedFor = typeof requestOrHeaders.get === "function"
      ? requestOrHeaders.get("x-forwarded-for")
      : asRecord["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor) {
      const ip = forwardedFor.split(",")[0]?.trim();
      if (ip) return ip;
    }
    const realIP = typeof requestOrHeaders.get === "function"
      ? (requestOrHeaders as Headers).get("x-real-ip")
      : asRecord["x-real-ip"];
    if (typeof realIP === "string" && realIP) {
      return realIP.trim();
    }
    return "127.0.0.1";
  }

  const trustedHops = env.TRUSTED_PROXY_HOPS;

  if (trustedHops > 0) {
    // Check x-forwarded-for header (may contain multiple IPs) and take the hop
    // the outermost trusted proxy appended — entries to its left are untrusted.
    const forwardedFor = headers.get("x-forwarded-for");
    if (forwardedFor) {
      const hops = forwardedFor
        .split(",")
        .map((hop) => hop.trim())
        .filter(Boolean);
      // Fewer entries than configured hops means the request did not traverse
      // the expected proxy chain, so nothing in this request is trustworthy —
      // share the fallback bucket instead of reading another client-settable
      // header.
      return hops[hops.length - trustedHops] ?? "127.0.0.1";
    }

    // Check x-real-ip header (set, not appended, by the closest proxy).
    // Only reachable when no x-forwarded-for arrived at all.
    const realIP = headers.get("x-real-ip");
    if (realIP) {
      return realIP.trim();
    }
  }

  // Fallback
  return "127.0.0.1";
}

/**
 * Adds rate limit headers to a NextResponse.
 * Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 */
export function addRateLimitHeaders(
  response: NextResponse,
  headers: { limit: number; remaining: number; reset: number }
): NextResponse {
  response.headers.set("X-RateLimit-Limit", String(headers.limit));
  response.headers.set("X-RateLimit-Remaining", String(headers.remaining));
  response.headers.set("X-RateLimit-Reset", String(headers.reset));
  return response;
}

/**
 * Creates a 429 Too Many Requests response with rate limit headers
 * and a calculated retryAfter value.
 */
export function createRateLimitedResponse(rateLimitData: {
  limit: number;
  remaining: number;
  reset: number;
}): NextResponse {
  const retryAfter = Math.max(
    0,
    Math.ceil((rateLimitData.reset - Date.now()) / 1000)
  );

  const response = NextResponse.json(
    {
      error: "Too many authentication attempts. Please try again later.",
      retryAfter,
    },
    { status: 429 }
  );

  return addRateLimitHeaders(response, rateLimitData);
}
