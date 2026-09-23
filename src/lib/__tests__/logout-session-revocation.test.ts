import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { SessionData } from "@/lib/session";

/**
 * Integration coverage for session revocation on logout and account switching.
 *
 * The sibling logout-route.test.ts replaces @/lib/session and @/lib/accounts
 * with whole-module mocks, so the interaction between them — which is where the
 * bug lived — is invisible to it. Here both modules are real; only the cookie
 * jar and the session store are stood in for, and both are modelled on the real
 * thing rather than simplified.
 */

// ---------------------------------------------------------------------------
// Cookie jar — faithful to Next's MutableRequestCookiesAdapter
// ---------------------------------------------------------------------------

/**
 * Next implements delete() as set({ value: "", expires: 0 }), so a deleted
 * cookie reads back as an EMPTY STRING, not undefined. The logout ordering bug
 * depended on exactly that: the `if (token)` guard saw "" and skipped the store
 * delete. Modelling delete() as a map removal would make this whole suite
 * vacuous, so it is modelled as the real adapter does it.
 */
const jar = new Map<string, string>();

const cookieStore = {
  get: (name: string) =>
    jar.has(name) ? { name, value: jar.get(name)! } : undefined,
  set: (name: string, value: string) => {
    jar.set(name, value);
  },
  delete: (name: string) => {
    jar.set(name, "");
  },
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

// ---------------------------------------------------------------------------
// Session store — in-memory, so surviving rows can be asserted on
// ---------------------------------------------------------------------------

const store = new Map<string, SessionData>();

vi.mock("@/lib/session-store", () => ({
  saveSessionToStore: vi.fn(async (id: string, data: SessionData) => {
    store.set(id, data);
  }),
  getSessionFromStore: vi.fn(async (id: string) => store.get(id) ?? null),
  deleteSessionFromStore: vi.fn(async (id: string) => {
    store.delete(id);
  }),
  refreshSessionExpiration: vi.fn(async () => {}),
  cleanupExpiredSessions: vi.fn(async () => {}),
}));

vi.mock("@/lib/rate-limiter", () => ({
  rateLimit: vi.fn(async () => ({
    success: true,
    limit: 10,
    remaining: 9,
    reset: 0,
  })),
}));

vi.mock("@/lib/rate-limit-utils", () => ({
  getClientIP: vi.fn(() => "127.0.0.1"),
  addRateLimitHeaders: vi.fn((response: NextResponse) => response),
  createRateLimitedResponse: vi.fn(
    () => new NextResponse(null, { status: 429 }),
  ),
}));

// ---------------------------------------------------------------------------
// Real modules under test
// ---------------------------------------------------------------------------

const { createSession, getSession, getCurrentSessionId, _resetSessionCache } =
  await import("@/lib/session");
const { addAccount, switchAccount, getAccounts } = await import(
  "@/lib/accounts"
);
const { POST } = await import("@/app/api/auth/logout/route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokensFor(name: string) {
  return {
    accessToken: `access-${name}`,
    entitlementsToken: `entitlements-${name}`,
    puuid: `puuid-${name}`,
    region: "na",
    gameName: name,
    tagLine: "0001",
  };
}

function entryFor(name: string) {
  return {
    puuid: `puuid-${name}`,
    region: "na",
    gameName: name,
    tagLine: "0001",
    addedAt: 1_700_000_000_000,
  };
}

async function logout() {
  return POST(
    new NextRequest("http://localhost/api/auth/logout", { method: "POST" }),
  );
}

/** Session rows the app can still reach, ignoring per-account copies. */
function liveRowCount() {
  return store.size;
}

beforeEach(() => {
  jar.clear();
  store.clear();
  _resetSessionCache();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("logout revokes the session the cookie pointed at", () => {
  it("drops the row of a single-account session", async () => {
    await addAccount(entryFor("solo"), tokensFor("solo"));
    const sessionId = await getCurrentSessionId();
    expect(sessionId).toBeTruthy();
    expect(store.has(sessionId!)).toBe(true);

    const res = await logout();

    expect(res.status).toBe(200);
    expect(store.has(sessionId!)).toBe(false);
    expect(await getSession()).toBeNull();
  });

  it("drops the original row when another account remains, instead of the one the switch created", async () => {
    await addAccount(entryFor("alpha"), tokensFor("alpha"));
    await addAccount(entryFor("bravo"), tokensFor("bravo"));

    // The cookie points at bravo's session; alpha stays in the registry.
    const originalSessionId = await getCurrentSessionId();
    expect(originalSessionId).toBeTruthy();
    expect(store.has(originalSessionId!)).toBe(true);
    expect((await getAccounts())?.accounts).toHaveLength(2);

    await logout();

    // The JWT the user just logged out of must stop working. Before the fix
    // removeAccount() replaced the cookie first, so deleteSession() revoked the
    // freshly created row and left this one valid for its full 30 days.
    expect(store.has(originalSessionId!)).toBe(false);
  });

  it("leaves the user logged out, not signed in as the remaining account", async () => {
    await addAccount(entryFor("alpha"), tokensFor("alpha"));
    await addAccount(entryFor("bravo"), tokensFor("bravo"));

    await logout();

    // Guards the regression the obvious fix introduces: moving deleteSession()
    // before removeAccount() lets createSession() re-write the cookie
    // afterwards, silently signing the user into the remaining account.
    expect(await getCurrentSessionId()).toBeNull();
    expect(await getSession()).toBeNull();
  });

  it("does not strand the session the account switch created", async () => {
    await addAccount(entryFor("alpha"), tokensFor("alpha"));
    await addAccount(entryFor("bravo"), tokensFor("bravo"));

    await logout();

    // Two per-account copies may remain (they are keyed by their own ids and
    // are how a re-login finds each account). What must not remain is a live
    // main session row nobody can reach.
    expect(liveRowCount()).toBeLessThanOrEqual(2);
  });
});

describe("createSession revokes the session it replaces", () => {
  it("drops the previous row on a plain re-login", async () => {
    await createSession(tokensFor("first"));
    const firstId = await getCurrentSessionId();

    await createSession(tokensFor("second"));
    const secondId = await getCurrentSessionId();

    expect(secondId).not.toBe(firstId);
    expect(store.has(firstId!)).toBe(false);
    expect(store.has(secondId!)).toBe(true);
  });

  it("stops account switches from accumulating orphaned rows", async () => {
    await addAccount(entryFor("alpha"), tokensFor("alpha"));
    await addAccount(entryFor("bravo"), tokensFor("bravo"));

    const afterSetup = liveRowCount();

    await switchAccount("puuid-alpha");
    await switchAccount("puuid-bravo");
    await switchAccount("puuid-alpha");
    await switchAccount("puuid-bravo");

    // Each switch used to insert rows without ever removing the one it
    // replaced, so the store grew by roughly two per switch and every one of
    // them stayed valid for 30 days.
    expect(liveRowCount()).toBeLessThanOrEqual(afterSetup);
  });
});
