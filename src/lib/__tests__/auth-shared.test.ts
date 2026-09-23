import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
//
// Every handler test (cookie/credentials/mfa/url) mocks this whole module out,
// so registerAuthenticatedSession itself was never executed by the suite. Here
// we mock only its two collaborators and exercise the real function.
// ---------------------------------------------------------------------------

vi.mock("@/lib/session", () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/accounts", () => ({
  addAccount: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Dynamic import
// ---------------------------------------------------------------------------

const { createSession } = await import("@/lib/session");
const { addAccount } = await import("@/lib/accounts");
const { registerAuthenticatedSession, AuthBodySchema } = await import(
  "@/lib/auth-handlers/shared"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tokens = {
  accessToken: "access-tok",
  entitlementsToken: "ent-tok",
  puuid: "puuid-1234",
  region: "eu",
  gameName: "Player",
  tagLine: "0001",
  country: "DE",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerAuthenticatedSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("leaves the session to addAccount instead of creating one of its own", async () => {
    // addAccount ends by calling createSession itself. A second call here would
    // rotate the session twice per login.
    await registerAuthenticatedSession(tokens, "riot-cookie-string");

    expect(addAccount).toHaveBeenCalledTimes(1);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("leaves no session behind when account registration fails", async () => {
    vi.mocked(addAccount).mockRejectedValueOnce(new Error("registry write failed"));

    await expect(
      registerAuthenticatedSession(tokens, "riot-cookie-string"),
    ).rejects.toThrow("registry write failed");

    expect(createSession).not.toHaveBeenCalled();
  });

  it("registers the account with the identity fields and a timestamp", async () => {
    const before = Date.now();
    await registerAuthenticatedSession(tokens, "riot-cookie-string");
    const after = Date.now();

    expect(addAccount).toHaveBeenCalledTimes(1);
    const [entry] = vi.mocked(addAccount).mock.calls[0]!;

    expect(entry).toMatchObject({
      puuid: "puuid-1234",
      region: "eu",
      gameName: "Player",
      tagLine: "0001",
    });
    expect(entry.addedAt).toBeGreaterThanOrEqual(before);
    expect(entry.addedAt).toBeLessThanOrEqual(after);
  });

  it("passes the full token set — including country and cookies — as the stored session", async () => {
    await registerAuthenticatedSession(tokens, "riot-cookie-string");

    const [, session] = vi.mocked(addAccount).mock.calls[0]!;
    expect(session).toEqual({
      accessToken: "access-tok",
      entitlementsToken: "ent-tok",
      puuid: "puuid-1234",
      region: "eu",
      gameName: "Player",
      tagLine: "0001",
      country: "DE",
      riotCookies: "riot-cookie-string",
    });
  });

  it("does not put the account entry and the stored session in the same object", async () => {
    // The registry entry is public-ish metadata; the session holds the tokens.
    // Collapsing them would leak credentials into the accounts cookie.
    await registerAuthenticatedSession(tokens, "riot-cookie-string");

    const [entry] = vi.mocked(addAccount).mock.calls[0]!;
    expect(entry).not.toHaveProperty("accessToken");
    expect(entry).not.toHaveProperty("entitlementsToken");
    expect(entry).not.toHaveProperty("riotCookies");
  });

  it("omits optional identity fields when Riot did not return them", async () => {
    const minimal = {
      accessToken: "access-tok",
      entitlementsToken: "ent-tok",
      puuid: "puuid-1234",
      region: "na",
    };

    await registerAuthenticatedSession(minimal, "");

    const [entry, session] = vi.mocked(addAccount).mock.calls[0]!;
    expect(entry.gameName).toBeUndefined();
    expect(entry.tagLine).toBeUndefined();
    expect(session.country).toBeUndefined();
  });
});

describe("AuthBodySchema", () => {
  it("accepts a credentials body", () => {
    const parsed = AuthBodySchema.safeParse({
      type: "auth",
      username: "user",
      password: "pass",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a multifactor body", () => {
    const parsed = AuthBodySchema.safeParse({
      type: "multifactor",
      code: "123456",
      cookie: "asid=...",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a url body", () => {
    const parsed = AuthBodySchema.safeParse({
      type: "url",
      url: "https://playvalorant.com/opt_in#access_token=a&id_token=b",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a cookie body", () => {
    const parsed = AuthBodySchema.safeParse({
      type: "cookie",
      cookie: "ssid=...",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a body whose type is not one of the four branches", () => {
    const parsed = AuthBodySchema.safeParse({
      type: "admin",
      username: "user",
      password: "pass",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a body with no discriminator at all", () => {
    const parsed = AuthBodySchema.safeParse({ username: "u", password: "p" });
    expect(parsed.success).toBe(false);
  });

  it.each([
    ["auth", { type: "auth", username: "user" }],
    ["auth", { type: "auth", password: "pass" }],
    ["multifactor", { type: "multifactor", code: "123456" }],
    ["multifactor", { type: "multifactor", cookie: "asid=..." }],
    ["url", { type: "url" }],
    ["cookie", { type: "cookie" }],
  ])("rejects a %s body that is missing a required field", (_type, body) => {
    expect(AuthBodySchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ["auth", { type: "auth", username: 1, password: "pass" }],
    ["multifactor", { type: "multifactor", code: 123456, cookie: "c" }],
    ["url", { type: "url", url: null }],
    ["cookie", { type: "cookie", cookie: [] }],
  ])("rejects a %s body whose field is not a string", (_type, body) => {
    expect(AuthBodySchema.safeParse(body).success).toBe(false);
  });
});
