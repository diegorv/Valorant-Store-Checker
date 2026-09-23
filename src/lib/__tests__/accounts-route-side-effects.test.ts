import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { SessionData } from "@/lib/session";

/**
 * Integration coverage for the read-only contract of GET /api/accounts.
 *
 * The sibling accounts-route.test.ts replaces @/lib/accounts with a whole-module
 * mock, so a session write inside the read is invisible to it — and the session
 * write was the bug. Here session.ts, accounts.ts and the route are all real;
 * only the cookie jar and the session store stand in, modelled on the real
 * thing as in logout-session-revocation.test.ts.
 */

// ---------------------------------------------------------------------------
// Cookie jar — faithful to Next's MutableRequestCookiesAdapter
// ---------------------------------------------------------------------------

/** Next implements delete() as set({ value: "" }), so a deleted cookie reads
 * back as an empty string rather than undefined. */
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

// ---------------------------------------------------------------------------
// Real modules under test
// ---------------------------------------------------------------------------

const { createSession, getCurrentSessionId, _resetSessionCache } = await import(
  "@/lib/session"
);
const { getAccounts } = await import("@/lib/accounts");
const { registerAuthenticatedSession } = await import(
  "@/lib/auth-handlers/shared"
);
const { GET } = await import("@/app/api/accounts/route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listRequest() {
  return new NextRequest("http://localhost/api/accounts");
}

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

beforeEach(() => {
  jar.clear();
  store.clear();
  _resetSessionCache();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/accounts on a session that predates the registry", () => {
  it("answers an empty list without touching the caller's session", async () => {
    await createSession(tokensFor("legacy"));
    const sessionId = await getCurrentSessionId();

    const res = await GET(listRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
    expect(await getCurrentSessionId()).toBe(sessionId);
    expect(store.has(sessionId!)).toBe(true);
    expect(await getAccounts()).toBeNull();
  });

  it("leaves exactly one valid session after two concurrent reads", async () => {
    await createSession(tokensFor("legacy"));
    const sessionId = await getCurrentSessionId();

    const [first, second] = await Promise.all([
      GET(listRequest()),
      GET(listRequest()),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // The jar is shared to model two requests arriving with the same cookie.
    // Migrating inside the read revoked that session twice and minted two
    // replacements, only one of which reached the browser — so every other
    // request still in flight 401'd.
    expect(store.size).toBe(1);
    expect(store.has(sessionId!)).toBe(true);
  });
});

describe("a login carries the pre-registry session into the registry", () => {
  it("keeps the earlier account in the switcher when a second one is added", async () => {
    await createSession(tokensFor("legacy"));

    await registerAuthenticatedSession(tokensFor("second"), "");

    const registry = await getAccounts();
    expect(registry?.accounts.map((account) => account.puuid)).toEqual([
      "puuid-legacy",
      "puuid-second",
    ]);
    expect(registry?.activePuuid).toBe("puuid-second");
  });

  it("registers the account that is already signed in on a plain re-login", async () => {
    await createSession(tokensFor("legacy"));

    await registerAuthenticatedSession(tokensFor("legacy"), "");

    const registry = await getAccounts();
    expect(registry?.accounts.map((account) => account.puuid)).toEqual([
      "puuid-legacy",
    ]);
  });
});
