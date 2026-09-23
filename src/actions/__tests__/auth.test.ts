import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before any import (vi.mock is hoisted)
// ---------------------------------------------------------------------------

// The global setup only stubs cookies(); this action also calls headers().
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "1.2.3.4" })),
}));

vi.mock("@/lib/riot-auth", () => ({
  completeAuthWithUrl: vi.fn(),
}));

vi.mock("@/lib/riot-reauth", () => ({
  refreshTokensWithCookies: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/accounts", () => ({
  addAccount: vi.fn().mockResolvedValue(undefined),
  migrateSessionToRegistry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/rate-limiter", () => ({
  rateLimit: vi.fn(),
}));

const { authenticateWithPaste } = await import("@/actions/auth");

const mockTokens = {
  accessToken: "access-tok",
  idToken: "id-tok",
  entitlementsToken: "ent-tok",
  puuid: "test-puuid-1234",
  region: "na",
};

function allowRateLimit() {
  return {
    success: true,
    limit: 10,
    remaining: 9,
    reset: Date.now() + 60_000,
    pending: Promise.resolve(0),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authenticateWithPaste — rate limiting", () => {
  it("rejects with the throttle message once the bucket is exhausted", async () => {
    const { rateLimit } = await import("@/lib/rate-limiter");
    vi.mocked(rateLimit).mockResolvedValue({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 60_000,
      pending: Promise.resolve(0),
    });

    const result = await authenticateWithPaste("ssid=whatever");

    expect(result).toEqual({
      success: false,
      error: "Too many authentication attempts. Please try again later.",
    });
  });

  it("does not reach Riot when throttled — neither the cookie nor the URL path", async () => {
    const { rateLimit } = await import("@/lib/rate-limiter");
    const { completeAuthWithUrl } = await import("@/lib/riot-auth");
    const { refreshTokensWithCookies } = await import("@/lib/riot-reauth");
    vi.mocked(rateLimit).mockResolvedValue({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 60_000,
      pending: Promise.resolve(0),
    });

    await authenticateWithPaste("ssid=whatever");
    await authenticateWithPaste("https://playvalorant.com/opt_in#access_token=x");

    expect(refreshTokensWithCookies).not.toHaveBeenCalled();
    expect(completeAuthWithUrl).not.toHaveBeenCalled();
  });

  it("consumes exactly one unit per attempt and lets an allowed attempt through", async () => {
    const { rateLimit } = await import("@/lib/rate-limiter");
    const { refreshTokensWithCookies } = await import("@/lib/riot-reauth");
    vi.mocked(rateLimit).mockResolvedValue(allowRateLimit());
    vi.mocked(refreshTokensWithCookies).mockResolvedValue({
      success: true,
      tokens: mockTokens,
      riotCookies: "ssid=new",
      namedCookies: { raw: "ssid=new" },
    });

    const result = await authenticateWithPaste("ssid=old");

    expect(result).toEqual({
      success: true,
      puuid: "test-puuid-1234",
      region: "na",
    });
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(refreshTokensWithCookies).toHaveBeenCalledTimes(1);
  });

  it("buckets by the IP the helper derives from the request headers", async () => {
    const { rateLimit } = await import("@/lib/rate-limiter");
    const { refreshTokensWithCookies } = await import("@/lib/riot-reauth");
    vi.mocked(rateLimit).mockResolvedValue(allowRateLimit());
    vi.mocked(refreshTokensWithCookies).mockResolvedValue({
      success: true,
      tokens: mockTokens,
      riotCookies: "ssid=new",
      namedCookies: { raw: "ssid=new" },
    });

    await authenticateWithPaste("ssid=old");

    // No trusted proxy hop is configured in tests, so the forged
    // x-forwarded-for above must not become the bucket key.
    expect(rateLimit).toHaveBeenCalledWith("127.0.0.1");
  });
});

describe("authenticateWithPaste — account registration", () => {
  it("leaves no session behind when account registration fails", async () => {
    const { rateLimit } = await import("@/lib/rate-limiter");
    const { refreshTokensWithCookies } = await import("@/lib/riot-reauth");
    const { createSession } = await import("@/lib/session");
    const { addAccount } = await import("@/lib/accounts");
    vi.mocked(rateLimit).mockResolvedValue(allowRateLimit());
    vi.mocked(refreshTokensWithCookies).mockResolvedValue({
      success: true,
      tokens: mockTokens,
      riotCookies: "ssid=new",
      namedCookies: { raw: "ssid=new" },
    });
    vi.mocked(addAccount).mockRejectedValueOnce(new Error("registry write failed"));

    const result = await authenticateWithPaste("ssid=old");

    // The user is told it failed, so they must not be holding a session cookie.
    expect(result).toEqual({ success: false, error: "registry write failed" });
    expect(createSession).not.toHaveBeenCalled();
  });
});
