import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";

/**
 * The registry's active account must never name an account the user is not
 * signed in as: store history labels its row with the active account's Riot ID
 * while the store itself comes from the live session.
 *
 * accounts.ts, session.ts and session-store.ts are all real here; only the
 * cookie jar and the SQLite handle stand in, modelled on the real thing as in
 * accounts-route-side-effects.test.ts. The failure is produced the way it
 * happens in production — Riot cookies to store and an ENCRYPTION_KEY the
 * store refuses — rather than by mocking the throw.
 */

// ---------------------------------------------------------------------------
// Session database — in-memory, one per test
// ---------------------------------------------------------------------------

let testClient: Client;

vi.mock("@/lib/session-db", () => ({
  initSessionDb: vi.fn(async () => testClient),
}));

// ---------------------------------------------------------------------------
// Cookie jar — faithful to Next's MutableRequestCookiesAdapter
// ---------------------------------------------------------------------------

/** Next implements delete() as set({ value: "", expires: new Date(0) })
 * (next/dist/compiled/@edge-runtime/cookies/index.js), so a deleted cookie
 * reads back as an empty string rather than undefined — and a delete is a
 * Set-Cookie write like any other: the adapter's delete trap records the name
 * and flushes the response cookies
 * (next/dist/server/web/spec-extension/adapters/request-cookies.js). */
const jar = new Map<string, string>();

/** Names of the cookies written, in order — the login's side effects. */
const cookieWrites: string[] = [];

const cookieStore = {
  get: (name: string) =>
    jar.has(name) ? { name, value: jar.get(name)! } : undefined,
  set: (name: string, value: string) => {
    jar.set(name, value);
    cookieWrites.push(name);
  },
  delete: (name: string) => {
    jar.set(name, "");
    cookieWrites.push(name);
  },
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

// ---------------------------------------------------------------------------
// Real modules under test
// ---------------------------------------------------------------------------

const { getSession, _resetSessionCache } = await import("@/lib/session");
const { getAccounts, getActiveAccount } = await import("@/lib/accounts");
const { SessionEncryptionUnavailableError } = await import(
  "@/lib/session-store"
);
const { registerAuthenticatedSession } = await import(
  "@/lib/auth-handlers/shared"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The key test/setup.node.ts installs before any import. */
const VALID_KEY = "0".repeat(64);

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

beforeEach(async () => {
  testClient = createClient({ url: ":memory:" });
  await testClient.execute(
    "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL)",
  );
  jar.clear();
  cookieWrites.length = 0;
  _resetSessionCache();
  process.env.ENCRYPTION_KEY = VALID_KEY;
});

afterEach(() => {
  process.env.ENCRYPTION_KEY = VALID_KEY;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("a login that fails partway through", () => {
  it("leaves the active account on the one that still holds the session", async () => {
    await registerAuthenticatedSession(tokensFor("alpha"), "");

    // An unusable ENCRYPTION_KEY makes the store refuse to write Riot cookies
    // it cannot encrypt — the reachable throw between the registry write and
    // the session write.
    process.env.ENCRYPTION_KEY = "not-a-64-hex-key";

    await expect(
      registerAuthenticatedSession(tokensFor("bravo"), "ssid=bravo"),
    ).rejects.toThrow(SessionEncryptionUnavailableError);

    process.env.ENCRYPTION_KEY = VALID_KEY;

    // The user is still signed in as alpha: the session cookie was never reached.
    expect((await getSession())?.puuid).toBe("puuid-alpha");

    // So the registry must still say alpha. DailyStoreSection labels the
    // store-history row with these two fields while keying it by the session's
    // puuid, so a divergence files alpha's rotation under bravo's Riot ID.
    const active = await getActiveAccount();
    expect(active?.puuid).toBe("puuid-alpha");
    expect(active?.gameName).toBe("alpha");
    expect(active?.tagLine).toBe("0001");

    const registry = await getAccounts();
    expect(registry?.activePuuid).toBe("puuid-alpha");
    expect(registry?.accounts.map((account) => account.puuid)).toEqual([
      "puuid-alpha",
    ]);
  });
});

describe("a login that succeeds", () => {
  it("writes the session cookie last, after the per-account copy and the registry", async () => {
    await registerAuthenticatedSession(tokensFor("alpha"), "");
    cookieWrites.length = 0;

    await registerAuthenticatedSession(tokensFor("bravo"), "ssid=bravo");

    // The per-account cookie is written twice: saveAccountSession revokes the
    // copy it replaces before writing the new one.
    expect(cookieWrites).toEqual([
      "valorant_session_puuid-br",
      "valorant_session_puuid-br",
      "valorant_accounts",
      "valorant_session",
    ]);
    expect((await getSession())?.puuid).toBe("puuid-bravo");
    expect((await getActiveAccount())?.puuid).toBe("puuid-bravo");
  });
});
