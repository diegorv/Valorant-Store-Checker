import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// TRUSTED_PROXY_HOPS is read on every getClientIP() call, so the tests mutate
// this mock instead of reloading the module.
const envMock = vi.hoisted(() => ({ TRUSTED_PROXY_HOPS: 0 }));

vi.mock("@/lib/env", () => ({ env: envMock }));

const {
  getClientIP,
  addRateLimitHeaders,
  createRateLimitedResponse,
} = await import("@/lib/rate-limit-utils");

// ---------------------------------------------------------------------------
// getClientIP tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  envMock.TRUSTED_PROXY_HOPS = 0;
});

describe("getClientIP with no trusted proxy (default)", () => {
  it("ignores x-forwarded-for, so every forged value shares one bucket", () => {
    const forged = new NextRequest("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    const otherForged = new NextRequest("http://localhost", {
      headers: { "x-forwarded-for": "5.6.7.8, 9.9.9.9" },
    });

    expect(getClientIP(forged)).toBe("127.0.0.1");
    expect(getClientIP(otherForged)).toBe(getClientIP(forged));
  });

  it("ignores x-real-ip as well", () => {
    const request = new NextRequest("http://localhost", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(getClientIP(request)).toBe("127.0.0.1");
  });

  it("neither header present returns fallback 127.0.0.1", () => {
    const request = new NextRequest("http://localhost");
    expect(getClientIP(request)).toBe("127.0.0.1");
  });
});

describe("getClientIP with one trusted proxy hop", () => {
  beforeEach(() => {
    envMock.TRUSTED_PROXY_HOPS = 1;
  });

  it("x-forwarded-for with single IP returns that IP", () => {
    const request = new NextRequest("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    expect(getClientIP(request)).toBe("1.2.3.4");
  });

  it("x-forwarded-for with multiple IPs returns the last (rightmost) IP", () => {
    const request = new NextRequest("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9" },
    });
    expect(getClientIP(request)).toBe("9.9.9.9");
  });

  it("a client-supplied prefix cannot change the bucket", () => {
    const first = new NextRequest("http://localhost", {
      headers: { "x-forwarded-for": "10.0.0.1, 9.9.9.9" },
    });
    const second = new NextRequest("http://localhost", {
      headers: { "x-forwarded-for": "10.0.0.2, 9.9.9.9" },
    });
    expect(getClientIP(first)).toBe("9.9.9.9");
    expect(getClientIP(second)).toBe("9.9.9.9");
  });

  it("x-forwarded-for with whitespace is trimmed", () => {
    const request = new NextRequest("http://localhost", {
      headers: { "x-forwarded-for": "  1.2.3.4  ,  5.6.7.8  " },
    });
    expect(getClientIP(request)).toBe("5.6.7.8");
  });

  it("x-forwarded-for empty string falls through to x-real-ip", () => {
    const request = new NextRequest("http://localhost", {
      headers: { "x-forwarded-for": "", "x-real-ip": "9.9.9.9" },
    });
    expect(getClientIP(request)).toBe("9.9.9.9");
  });

  it("x-real-ip present (no x-forwarded-for) returns x-real-ip value", () => {
    const request = new NextRequest("http://localhost", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(getClientIP(request)).toBe("9.9.9.9");
  });

  it("neither header present returns fallback 127.0.0.1", () => {
    const request = new NextRequest("http://localhost");
    expect(getClientIP(request)).toBe("127.0.0.1");
  });

  it("accepts a plain Headers object (as returned by next/headers)", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" });
    expect(getClientIP(headers)).toBe("9.9.9.9");
  });
});

describe("getClientIP with two trusted proxy hops", () => {
  beforeEach(() => {
    envMock.TRUSTED_PROXY_HOPS = 2;
  });

  it("returns the IP two hops from the right", () => {
    const request = new NextRequest("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9" },
    });
    expect(getClientIP(request)).toBe("5.6.7.8");
  });

  it("x-forwarded-for shorter than the configured chain shares the fallback bucket", () => {
    // The request skipped a trusted hop, so x-real-ip is client-settable here:
    // reading it would hand every forged value its own bucket.
    const first = new NextRequest("http://localhost", {
      headers: { "x-forwarded-for": "9.9.9.9", "x-real-ip": "10.0.0.1" },
    });
    const second = new NextRequest("http://localhost", {
      headers: { "x-forwarded-for": "9.9.9.9", "x-real-ip": "10.0.0.2" },
    });
    expect(getClientIP(first)).toBe("127.0.0.1");
    expect(getClientIP(second)).toBe("127.0.0.1");
  });

  it("x-real-ip is still used when no x-forwarded-for arrives at all", () => {
    const request = new NextRequest("http://localhost", {
      headers: { "x-real-ip": "8.8.8.8" },
    });
    expect(getClientIP(request)).toBe("8.8.8.8");
  });
});

// ---------------------------------------------------------------------------
// addRateLimitHeaders tests
// ---------------------------------------------------------------------------

describe("addRateLimitHeaders", () => {
  it("adds all three rate limit headers to the response", () => {
    const response = new NextResponse("ok");
    const headers = { limit: 10, remaining: 9, reset: 1234567890 };
    addRateLimitHeaders(response, headers);

    expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("9");
    expect(response.headers.get("X-RateLimit-Reset")).toBe("1234567890");
  });

  it("returns the same response object", () => {
    const response = new NextResponse("ok");
    const headers = { limit: 10, remaining: 9, reset: 1234567890 };
    const result = addRateLimitHeaders(response, headers);
    expect(result).toBe(response);
  });
});

// ---------------------------------------------------------------------------
// createRateLimitedResponse tests
// ---------------------------------------------------------------------------

describe("createRateLimitedResponse", () => {
  it("returns NextResponse with status 429", () => {
    const rateLimitData = { limit: 10, remaining: 0, reset: Date.now() + 60000 };
    const response = createRateLimitedResponse(rateLimitData);
    expect(response.status).toBe(429);
  });

  it("body contains error string and numeric retryAfter >= 0", async () => {
    const resetTime = Date.now() + 60000;
    const rateLimitData = { limit: 10, remaining: 0, reset: resetTime };
    const response = createRateLimitedResponse(rateLimitData);
    const body = await response.json();

    expect(body.error).toBeTruthy();
    expect(typeof body.retryAfter).toBe("number");
    expect(body.retryAfter).toBeGreaterThanOrEqual(0);
  });

  it("retryAfter is calculated as (reset - Date.now()) / 1000, floored at 0", async () => {
    // When reset is far in the future, retryAfter should be positive
    const resetTime = Date.now() + 60000;
    const rateLimitData = { limit: 10, remaining: 0, reset: resetTime };
    const response = createRateLimitedResponse(rateLimitData);
    const body = await response.json();

    // Approximately 60 seconds (60,000ms / 1000), give some tolerance for test execution time
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.retryAfter).toBeLessThanOrEqual(60);
  });

  it("retryAfter floors at 0 when reset is in the past", async () => {
    const rateLimitData = { limit: 10, remaining: 0, reset: Date.now() - 1000 };
    const response = createRateLimitedResponse(rateLimitData);
    const body = await response.json();

    expect(body.retryAfter).toBe(0);
  });

  it("calls addRateLimitHeaders to add rate limit headers to the response", async () => {
    const resetTime = Date.now() + 60000;
    const rateLimitData = { limit: 10, remaining: 0, reset: resetTime };
    const response = createRateLimitedResponse(rateLimitData);

    expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("X-RateLimit-Reset")).toBe(String(resetTime));
  });

  it("returned response has all three X-RateLimit-* headers", async () => {
    const resetTime = Date.now() + 60000;
    const rateLimitData = { limit: 5, remaining: 2, reset: resetTime };
    const response = createRateLimitedResponse(rateLimitData);

    expect(response.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("2");
    expect(response.headers.get("X-RateLimit-Reset")).toBe(String(resetTime));
  });
});
