import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionData } from "@/lib/schemas/session";

// ---------------------------------------------------------------------------
// Mocks — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

// The most hostile env module a test could write: NODE_ENV pinned to "test".
// The cookie flags and the log level must ignore it and read the raw process
// environment, so this mock can never turn a fail-closed case green.
vi.mock("@/lib/env", () => ({
  env: { SESSION_SECRET: "test-secret-key-for-vitest", NODE_ENV: "test" },
}));

const mockSaveSessionToStore = vi.fn();
const mockGetSessionFromStore = vi.fn();
const mockDeleteSessionFromStore = vi.fn();
const mockRefreshSessionExpiration = vi.fn();

vi.mock("@/lib/session-store", () => ({
  saveSessionToStore: (...args: unknown[]) => mockSaveSessionToStore(...args),
  getSessionFromStore: (...args: unknown[]) => mockGetSessionFromStore(...args),
  deleteSessionFromStore: (...args: unknown[]) => mockDeleteSessionFromStore(...args),
  refreshSessionExpiration: (...args: unknown[]) => mockRefreshSessionExpiration(...args),
  cleanupExpiredSessions: vi.fn(),
}));

vi.mock("jose", () => ({
  jwtVerify: vi.fn(async () => ({ payload: { sessionId: "test-session-id" } })),
  SignJWT: vi.fn(function (this: Record<string, unknown>) {
    return {
      setProtectedHeader: vi.fn().mockReturnThis(),
      setIssuedAt: vi.fn().mockReturnThis(),
      setExpirationTime: vi.fn().mockReturnThis(),
      sign: vi.fn(async () => "mock-jwt-token"),
    };
  }),
}));

let cookieValues: Record<string, string> = {};
const mockCookiesSet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) =>
      cookieValues[name] ? { value: cookieValues[name] } : undefined,
    ),
    set: mockCookiesSet,
    delete: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Import modules under test AFTER the mock declarations
// ---------------------------------------------------------------------------

const { createSession, refreshSession } = await import("@/lib/session");
const { addAccount } = await import("@/lib/accounts");
const { createLogger } = await import("@/lib/logger");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalNodeEnv = process.env.NODE_ENV;
const originalLogLevel = process.env.LOG_LEVEL;

/** NODE_ENV is typed readonly and as a closed union — tests need the raw bag */
function setEnv(key: string, value: string | undefined): void {
  const bag = process.env as Record<string, string | undefined>;
  if (value === undefined) {
    delete bag[key];
  } else {
    bag[key] = value;
  }
}

/** The `secure` flag the cookie named `name` was last set with */
function secureFlagOf(name: string): boolean | undefined {
  const call = [...mockCookiesSet.mock.calls]
    .reverse()
    .find(([cookieName]) => cookieName === name);
  return call?.[2]?.secure;
}

const tokens = {
  accessToken: "test-access-token",
  entitlementsToken: "test-entitlements-token",
  puuid: "test-puuid-12345678",
  region: "na",
};

beforeEach(() => {
  cookieValues = {};
  mockCookiesSet.mockReset();
  mockSaveSessionToStore.mockReset();
  mockGetSessionFromStore.mockReset().mockResolvedValue(null);
  mockDeleteSessionFromStore.mockReset();
  mockRefreshSessionExpiration.mockReset();
});

afterEach(() => {
  setEnv("NODE_ENV", originalNodeEnv);
  setEnv("LOG_LEVEL", originalLogLevel);
});

describe("session cookie Secure flag", () => {
  it("is set in an environment that is neither development nor test", async () => {
    setEnv("NODE_ENV", "staging");

    await createSession(tokens);

    expect(secureFlagOf("valorant_session")).toBe(true);
  });

  it("is set when NODE_ENV is unset", async () => {
    setEnv("NODE_ENV", undefined);

    await createSession(tokens);

    expect(secureFlagOf("valorant_session")).toBe(true);
  });

  it("is left off in development", async () => {
    setEnv("NODE_ENV", "development");

    await createSession(tokens);

    expect(secureFlagOf("valorant_session")).toBe(false);
  });

  it("is left off in test", async () => {
    setEnv("NODE_ENV", "test");

    await createSession(tokens);

    expect(secureFlagOf("valorant_session")).toBe(false);
  });

  it("is set on the cookie refreshSession rewrites", async () => {
    setEnv("NODE_ENV", "staging");
    cookieValues["valorant_session"] = "mock-jwt-token";
    mockGetSessionFromStore.mockResolvedValue({
      accessToken: "test-access-token",
      entitlementsToken: "test-entitlements-token",
      puuid: "test-puuid-12345678",
      region: "na",
      createdAt: Date.now(),
    } satisfies SessionData);

    await expect(refreshSession()).resolves.toBe(true);

    expect(secureFlagOf("valorant_session")).toBe(true);
  });
});

describe("account cookie Secure flag", () => {
  it("is set on the registry and per-account cookies outside development and test", async () => {
    setEnv("NODE_ENV", "staging");

    await addAccount(
      { puuid: "test-puuid-12345678", region: "na", addedAt: Date.now() },
      tokens,
    );

    expect(secureFlagOf("valorant_accounts")).toBe(true);
    expect(secureFlagOf("valorant_session_test-puu")).toBe(true);
  });

  it("is left off on both in development", async () => {
    setEnv("NODE_ENV", "development");

    await addAccount(
      { puuid: "test-puuid-12345678", region: "na", addedAt: Date.now() },
      tokens,
    );

    expect(secureFlagOf("valorant_accounts")).toBe(false);
    expect(secureFlagOf("valorant_session_test-puu")).toBe(false);
  });
});

describe("default log level", () => {
  it("is warn in an environment that is neither development nor test", () => {
    setEnv("NODE_ENV", "staging");
    setEnv("LOG_LEVEL", undefined);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    createLogger("cookie-flags-test").debug("secret-looking payload");

    expect(debug).not.toHaveBeenCalled();
    debug.mockRestore();
  });

  it("is still debug in development", () => {
    setEnv("NODE_ENV", "development");
    setEnv("LOG_LEVEL", undefined);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    createLogger("cookie-flags-test").debug("dev noise");

    expect(debug).toHaveBeenCalled();
    debug.mockRestore();
  });

  it("still honours an explicit LOG_LEVEL override", () => {
    setEnv("NODE_ENV", "staging");
    setEnv("LOG_LEVEL", "debug");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    createLogger("cookie-flags-test").debug("operator asked for this");

    expect(debug).toHaveBeenCalled();
    debug.mockRestore();
  });
});
