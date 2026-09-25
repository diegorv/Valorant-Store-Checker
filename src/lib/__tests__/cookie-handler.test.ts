import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/riot-reauth", () => ({
  refreshTokensWithCookies: vi.fn(),
}));

vi.mock("@/lib/auth-handlers/shared", () => ({
  registerAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Dynamic import
// ---------------------------------------------------------------------------

const { handleCookieAuth } = await import("@/lib/auth-handlers/cookie");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockTokens = {
  accessToken: "access-tok",
  idToken: "id-tok",
  entitlementsToken: "ent-tok",
  puuid: "test-puuid-1234",
  region: "na",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleCookieAuth", () => {
  it("refreshTokensWithCookies returns success -> 200 with puuid and region", async () => {
    const { refreshTokensWithCookies } = await import("@/lib/riot-reauth");
    vi.mocked(refreshTokensWithCookies).mockResolvedValue({
      success: true,
      tokens: mockTokens,
      riotCookies: "ssid=new",
      namedCookies: { raw: "ssid=new" },
    });

    const { registerAuthenticatedSession } = await import("@/lib/auth-handlers/shared");

    const res = await handleCookieAuth({
      type: "cookie",
      cookie: "ssid=old",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.puuid).toBe("test-puuid-1234");
    expect(body.data.region).toBe("na");
    expect(registerAuthenticatedSession).toHaveBeenCalled();
  });

  it("refreshTokensWithCookies returns failure -> 401 with error message", async () => {
    const { refreshTokensWithCookies } = await import("@/lib/riot-reauth");
    vi.mocked(refreshTokensWithCookies).mockResolvedValue({
      success: false,
      error: "cookie_expired",
    });

    const res = await handleCookieAuth({
      type: "cookie",
      cookie: "ssid=expired",
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "cookie_expired", code: "UNAUTHORIZED" });
  });

  it("failure without an error message -> 401 with the default message", async () => {
    const { refreshTokensWithCookies } = await import("@/lib/riot-reauth");
    vi.mocked(refreshTokensWithCookies).mockResolvedValue({
      success: false,
      error: "",
    });

    const res = await handleCookieAuth({
      type: "cookie",
      cookie: "ssid=expired",
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Failed to authenticate with cookies", code: "UNAUTHORIZED" });
  });

  it("does not rate limit on its own — that is the route's job", async () => {
    const { refreshTokensWithCookies } = await import("@/lib/riot-reauth");
    vi.mocked(refreshTokensWithCookies).mockResolvedValue({
      success: true,
      tokens: mockTokens,
      riotCookies: "ssid=new",
      namedCookies: { raw: "ssid=new" },
    });

    const res = await handleCookieAuth({ type: "cookie", cookie: "ssid=old" });

    expect(res.headers.get("X-RateLimit-Limit")).toBeNull();
    expect(res.headers.get("X-RateLimit-Remaining")).toBeNull();
  });
});
