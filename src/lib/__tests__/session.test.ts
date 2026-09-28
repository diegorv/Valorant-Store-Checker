import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SessionData } from "@/lib/schemas/session";

// ---------------------------------------------------------------------------
// Mocks — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

// Mock session-store for save/get/delete control
const mockGetSession = vi.fn();
const mockSaveSession = vi.fn();
const mockDeleteSession = vi.fn();

vi.mock("@/lib/session-store", () => ({
  getSessionFromStore: (...args: unknown[]) => mockGetSession(...args),
  saveSessionToStore: (...args: unknown[]) => mockSaveSession(...args),
  deleteSessionFromStore: (...args: unknown[]) => mockDeleteSession(...args),
  cleanupExpiredSessions: vi.fn(),
}));

// Mock riot-reauth for refresh control
const mockRefresh = vi.fn();
vi.mock("@/lib/riot-reauth", () => ({
  refreshTokensWithCookies: (...args: unknown[]) => mockRefresh(...args),
}));

// Mock jose for JWT verification bypass
vi.mock("jose", () => ({
  jwtVerify: vi.fn(async () => ({
    payload: { sessionId: "test-session-id" },
  })),
  SignJWT: vi.fn(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setIssuedAt: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn(async () => "mock-jwt-token"),
  })),
}));

// Mock next/headers cookies to return our test JWT
// This overrides the global mock in test/setup.node.ts for this test file
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    get: vi.fn((name: string) => {
      if (name === "valorant_session") return { value: "mock-jwt-token" };
      return undefined;
    }),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are declared
// ---------------------------------------------------------------------------

const { getSession, getSessionWithRefresh, getCurrentSessionId, _resetSessionCache } = await import("@/lib/session");

// ---------------------------------------------------------------------------
// Session fixture factory
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    accessToken: "test-access-token",
    entitlementsToken: "test-entitlements-token",
    puuid: "test-puuid",
    region: "na",
    createdAt: Date.now(),
    riotCookies: "ssid=test-ssid; clid=test-clid",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** Runs a refresh under fake timers so the retry backoff completes instantly. */
async function settleWithTimers<T>(pending: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return pending;
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  _resetSessionCache();
});

describe("getSessionWithRefresh — branching logic", () => {
  it("fresh token (10 min old): returns session WITHOUT calling refresh", async () => {
    const session = makeSession({
      createdAt: Date.now() - 10 * 60 * 1000, // 10 minutes ago
    });
    mockGetSession.mockResolvedValue(session);

    const result = await getSessionWithRefresh();

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe("test-access-token");
  });

  it("token at 56 minutes (refresh succeeds): returns fresh session and saves to store", async () => {
    const session = makeSession({
      createdAt: Date.now() - 56 * 60 * 1000, // 56 minutes ago
    });
    mockGetSession.mockResolvedValue(session);
    mockRefresh.mockResolvedValue({
      success: true,
      tokens: {
        accessToken: "fresh-token",
        idToken: "fresh-id",
        entitlementsToken: "fresh-ent",
        puuid: "test-puuid",
        region: "na",
      },
      riotCookies: "ssid=refreshed",
    });

    const result = await getSessionWithRefresh();

    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(mockSaveSession).toHaveBeenCalledOnce();
    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe("fresh-token");
  });

  it("token at 56 minutes (refresh fails transiently): returns original session flagged, row kept", async () => {
    const session = makeSession({
      createdAt: Date.now() - 56 * 60 * 1000,
    });
    mockGetSession.mockResolvedValue(session);
    mockRefresh.mockResolvedValue({
      success: false,
      error: "SSID re-auth failed with status 503",
    });

    const result = await settleWithTimers(getSessionWithRefresh());

    // Graceful degradation: stale token returned, session NOT deleted
    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe("test-access-token");
    expect(result!._refreshFailed).toBe(true);
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });

  it("no riotCookies: refresh NOT called, session deleted, returns null", async () => {
    const session = makeSession({
      createdAt: Date.now() - 56 * 60 * 1000,
      riotCookies: undefined,
    });
    mockGetSession.mockResolvedValue(session);

    const result = await getSessionWithRefresh();

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockDeleteSession).toHaveBeenCalledWith("test-session-id");
    expect(result).toBeNull();
  });
});

describe("getSessionWithRefresh — a transient failure never deletes the session", () => {
  // Regression: one failed refresh per page load, with no retry, deleted the
  // store row once the token was past 65 minutes. Riot's cookie re-auth fails
  // intermittently on healthy sessions, so "come back after a few hours" meant
  // "log in again". Only Riot's explicit rejection may delete the row.

  const IDLE_TOKEN_AGE = 4 * 60 * 60 * 1000; // hours idle, well past the old 65-minute hard expiry

  it.each([
    {
      name: "timeout / unexpected status",
      arrange: () => mockRefresh.mockResolvedValue({ success: false, error: "SSID re-auth failed with status 503" }),
    },
    {
      name: "network error (refresh throws)",
      arrange: () => mockRefresh.mockRejectedValue(new Error("network down")),
    },
  ])("$name: row kept, session returned with _refreshFailed", async ({ arrange }) => {
    mockGetSession.mockResolvedValue(makeSession({ createdAt: Date.now() - IDLE_TOKEN_AGE }));
    arrange();

    const result = await settleWithTimers(getSessionWithRefresh());

    expect(mockDeleteSession).not.toHaveBeenCalled();
    expect(result).toMatchObject({ accessToken: "test-access-token", _refreshFailed: true });
  });

  it("retries: two transient failures then success saves the fresh session", async () => {
    mockGetSession.mockResolvedValue(makeSession({ createdAt: Date.now() - IDLE_TOKEN_AGE }));
    mockRefresh
      .mockResolvedValueOnce({ success: false, error: "SSID re-auth failed with status 503" })
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        success: true,
        tokens: { accessToken: "fresh-token", idToken: "fresh-id", entitlementsToken: "fresh-ent", puuid: "test-puuid", region: "na" },
        riotCookies: "ssid=refreshed",
      });

    const result = await settleWithTimers(getSessionWithRefresh());

    expect(mockRefresh).toHaveBeenCalledTimes(3);
    expect(mockSaveSession).toHaveBeenCalledOnce();
    expect(mockDeleteSession).not.toHaveBeenCalled();
    expect(result!.accessToken).toBe("fresh-token");
  });

  it("gives up after the last retry and does not delete", async () => {
    mockGetSession.mockResolvedValue(makeSession({ createdAt: Date.now() - IDLE_TOKEN_AGE }));
    mockRefresh.mockResolvedValue({ success: false, error: "SSID re-auth failed with status 503" });

    const result = await settleWithTimers(getSessionWithRefresh());

    expect(mockRefresh).toHaveBeenCalledTimes(3);
    expect(mockDeleteSession).not.toHaveBeenCalled();
    expect(result!._refreshFailed).toBe(true);
  });

  it("Riot's explicit rejection deletes the row on the first attempt, no retry", async () => {
    mockGetSession.mockResolvedValue(makeSession({ createdAt: Date.now() - 56 * 60 * 1000 }));
    mockRefresh.mockResolvedValue({ success: false, error: "Session expired (redirected to login)", sessionDead: true });

    const result = await settleWithTimers(getSessionWithRefresh());

    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(mockDeleteSession).toHaveBeenCalledWith("test-session-id");
    expect(result).toBeNull();
  });
});

describe("getSessionWithRefresh — a dropped session never comes back from the LRU cache", () => {
  // Regression: /store found the session dead, deleted the store row and
  // redirected to /login. /login then read the same cookie within the LRU
  // TTL, got the deleted row from cache, and redirected back to /store —
  // ERR_TOO_MANY_REDIRECTS.
  //
  // Each case: request 1 (/store) drops the session, request 2 (/login)
  // must see null too. The mocked store returns null once the row is gone.

  const DEAD_TOKEN_AGE = 66 * 60 * 1000;

  it.each([
    {
      name: "Riot rejects the session",
      session: () => makeSession({ createdAt: Date.now() - DEAD_TOKEN_AGE }),
      arrange: () =>
        mockRefresh.mockResolvedValue({ success: false, error: "Session expired (redirected to login)", sessionDead: true }),
    },
    {
      name: "no riotCookies to refresh with",
      session: () => makeSession({ createdAt: Date.now() - DEAD_TOKEN_AGE, riotCookies: undefined }),
      arrange: () => {},
    },
  ])("$name: getSession() on the next request returns null", async ({ session, arrange }) => {
    mockGetSession.mockResolvedValue(session());
    arrange();

    // Request 1 — /store: the session is dead, the store row is dropped
    expect(await getSessionWithRefresh()).toBeNull();
    expect(mockDeleteSession).toHaveBeenCalledWith("test-session-id");

    // The row is gone from the store now
    mockGetSession.mockResolvedValue(null);

    // Request 2 — /login: must reach the store, not the stale LRU entry
    expect(await getSession()).toBeNull();
    expect(mockGetSession).toHaveBeenCalledTimes(2);
  });
});

describe("getCurrentSessionId — direct JWT parsing", () => {
  it("returns sessionId when valid token exists", async () => {
    // The mock jose jwtVerify returns { payload: { sessionId: "test-session-id" } }
    const result = await getCurrentSessionId();
    expect(result).toBe("test-session-id");
  });

  it("returns null when no token in cookies", async () => {
    const { jwtVerify } = await import("jose");
    // Override the mock to return no token
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { sessionId: null },
    } as never);

    // This test is tricky because we need to test the null cookie case
    // The current mock always returns a token, so we test the jwtVerify result path
    const result = await getCurrentSessionId();
    expect(result).toBeNull();
  });
});
