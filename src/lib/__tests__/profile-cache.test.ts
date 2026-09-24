import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProfileData } from "@/lib/profile-cache";

// ---------------------------------------------------------------------------
// Mock dependencies — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();
const mockRedisScan = vi.fn();

vi.mock("@/lib/redis-client", () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
    scan: (...args: unknown[]) => mockRedisScan(...args),
  },
}));

const mockGetPlayerLoadout = vi.fn();
vi.mock("@/lib/riot-loadout", () => ({
  getPlayerLoadout: (...args: unknown[]) => mockGetPlayerLoadout(...args),
}));

const mockGetHenrikAccount = vi.fn();
const mockGetHenrikMMR = vi.fn();
const mockGetHenrikStoredMatches = vi.fn();
vi.mock("@/lib/henrik-api", () => ({
  getHenrikAccount: (...args: unknown[]) => mockGetHenrikAccount(...args),
  getHenrikMMR: (...args: unknown[]) => mockGetHenrikMMR(...args),
  getHenrikStoredMatches: (...args: unknown[]) => mockGetHenrikStoredMatches(...args),
}));

const mockGetPlayerCardByUuid = vi.fn();
const mockGetPlayerTitleByUuid = vi.fn();
const mockGetCompetitiveTierIconByTier = vi.fn();
vi.mock("@/lib/valorant-api", () => ({
  getPlayerCardByUuid: (...args: unknown[]) => mockGetPlayerCardByUuid(...args),
  getPlayerTitleByUuid: (...args: unknown[]) => mockGetPlayerTitleByUuid(...args),
  getCompetitiveTierIconByTier: (...args: unknown[]) => mockGetCompetitiveTierIconByTier(...args),
}));

const mockLogWarn = vi.fn();
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockLogWarn,
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are declared
// ---------------------------------------------------------------------------

const { getProfileData, clearProfileCache, PROFILE_CACHE_VERSION } = await import("@/lib/profile-cache");

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeTokens(puuid = "test-puuid", region = "na") {
  return {
    accessToken: "test-access-token",
    entitlementsToken: "test-entitlements-token",
    puuid,
    region,
  };
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function makeCacheEntry(data: ProfileData, cachedAt: number = Date.now() - 60000, version: number | null = PROFILE_CACHE_VERSION) {
  // null: an entry written before versioning existed (no `version` key at all)
  return JSON.stringify(version === null ? { data, cachedAt } : { data, cachedAt, version });
}

function makeMockLoadout(overrides: Partial<{ PlayerCardID: string; PlayerTitleID: string; AccountLevel: number; HideAccountLevel: boolean }> = {}) {
  return {
    Identity: {
      PlayerCardID: "card-uuid-1",
      PlayerTitleID: "title-uuid-1",
      AccountLevel: 42,
      HideAccountLevel: false,
      ...overrides,
    },
    Guns: [],
    Sprays: [],
  };
}

function makeMockAccount(overrides: Partial<{ name: string; tag: string; account_level: number }> = {}) {
  return {
    puuid: "test-puuid",
    region: "na",
    name: "TestPlayer",
    tag: "NA1",
    account_level: 99,
    ...overrides,
  };
}

function makeMockMMR(overrides: Partial<{ current: object; peak: object; seasonal: object[] }> = {}) {
  return {
    current: {
      tier: { id: 10, name: "Gold 1" },
      rr: 55,
      last_change: 12,
    },
    peak: {
      tier: { id: 12, name: "Platinum 1" },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockGetHenrikStoredMatches.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue("OK");
  mockRedisDel.mockResolvedValue(1);
  mockRedisScan.mockResolvedValue(["0", []]);
});

describe("getProfileData — Tier 0 (cache)", () => {
  it("Tier 0: fresh cache hit (< 6h) returns with fromCache:true, does NOT call any APIs", async () => {
    const cachedProfile: ProfileData = {
      playerCardId: "card-123",
      fromCache: false,
      partial: false,
      henrikFailed: false,
    };
    const cachedAt = Date.now() - 5 * 60 * 60 * 1000; // 5h ago
    mockRedisGet.mockResolvedValue(makeCacheEntry(cachedProfile, cachedAt));

    const result = await getProfileData(makeTokens(), "na");

    expect(result.fromCache).toBe(true);
    expect(result.cachedAt).toBe(cachedAt);
    expect(result.nextUpdateAt).toBe(cachedAt + SIX_HOURS_MS);
    expect(mockGetPlayerLoadout).not.toHaveBeenCalled();
    expect(mockGetHenrikAccount).not.toHaveBeenCalled();
    expect(mockGetHenrikMMR).not.toHaveBeenCalled();
  });

  it("Tier 0: stale cache (>= 6h) proceeds to Tier 1 API fetch", async () => {
    const cachedProfile: ProfileData = {
      playerCardId: "card-123",
      fromCache: false,
      partial: false,
      henrikFailed: false,
    };
    mockRedisGet.mockResolvedValue(makeCacheEntry(cachedProfile, Date.now() - 7 * 60 * 60 * 1000)); // 7h ago

    mockGetPlayerLoadout.mockResolvedValue(makeMockLoadout());
    mockGetHenrikAccount.mockResolvedValue(makeMockAccount());
    mockGetHenrikMMR.mockResolvedValue(makeMockMMR());
    mockGetPlayerCardByUuid.mockResolvedValue({ smallArt: "", wideArt: "", largeArt: "" });
    mockGetPlayerTitleByUuid.mockResolvedValue({ titleText: "Test Title" });
    mockGetCompetitiveTierIconByTier.mockResolvedValue("https://ranked.icon");

    const result = await getProfileData(makeTokens(), "na");

    // Should have gone to Tier 1 (API fetch happened)
    expect(mockGetPlayerLoadout).toHaveBeenCalled();
    expect(result.fromCache).toBe(false);
  });

  it("Tier 0: malformed cache entry triggers redis.del and proceeds to Tier 1", async () => {
    mockRedisGet.mockResolvedValue("{invalid-json");
    mockRedisDel.mockResolvedValue(1);

    mockGetPlayerLoadout.mockResolvedValue(makeMockLoadout());
    mockGetHenrikAccount.mockResolvedValue(makeMockAccount());
    mockGetHenrikMMR.mockResolvedValue(makeMockMMR());
    mockGetPlayerCardByUuid.mockResolvedValue({ smallArt: "", wideArt: "", largeArt: "" });
    mockGetPlayerTitleByUuid.mockResolvedValue({ titleText: "Test Title" });
    mockGetCompetitiveTierIconByTier.mockResolvedValue("https://ranked.icon");

    const result = await getProfileData(makeTokens(), "na");

    expect(mockRedisDel).toHaveBeenCalled();
    expect(mockGetPlayerLoadout).toHaveBeenCalled();
    expect(result.fromCache).toBe(false);
  });
});

describe("getProfileData — Tier 1 (API fetch)", () => {
  it("Tier 1: all APIs succeed → partial:false, result cached", async () => {
    mockRedisGet.mockResolvedValue(null);

    mockGetPlayerLoadout.mockResolvedValue(makeMockLoadout());
    mockGetHenrikAccount.mockResolvedValue(makeMockAccount());
    mockGetHenrikMMR.mockResolvedValue(makeMockMMR());
    mockGetPlayerCardByUuid.mockResolvedValue({
      smallArt: "https://card.small",
      wideArt: "https://card.wide",
      largeArt: "https://card.large",
    });
    mockGetPlayerTitleByUuid.mockResolvedValue({ titleText: "Champion" });
    mockGetCompetitiveTierIconByTier.mockResolvedValue("https://ranked.icon");

    const result = await getProfileData(makeTokens(), "na");

    expect(result.partial).toBe(false);
    expect(result.henrikFailed).toBe(false);
    expect(mockRedisSet).toHaveBeenCalledWith(
      "profile:test-puuid",
      expect.any(String),
      { ex: SIX_HOURS_MS / 1000 },
    );
    expect(result.nextUpdateAt).toBe(result.cachedAt! + SIX_HOURS_MS);
  });

  it("Tier 1: Henrik account returns nothing (404) but loadout succeeds → still cached", async () => {
    mockRedisGet.mockResolvedValue(null);

    mockGetPlayerLoadout.mockResolvedValue(makeMockLoadout());
    mockGetHenrikAccount.mockResolvedValue(null);
    mockGetHenrikMMR.mockResolvedValue(makeMockMMR());
    mockGetPlayerCardByUuid.mockResolvedValue({ smallArt: "", wideArt: "", largeArt: "" });
    mockGetPlayerTitleByUuid.mockResolvedValue({ titleText: "Test Title" });
    mockGetCompetitiveTierIconByTier.mockResolvedValue("https://ranked.icon");

    const result = await getProfileData(makeTokens(), "na");

    expect(result.partial).toBe(false);
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it("Tier 1: redis.get rejects with timeout → logs a warning and proceeds to API fetch", async () => {
    mockRedisGet.mockRejectedValue(new Error("Redis timeout exceeded"));
    mockRedisSet.mockResolvedValue("OK");
    mockRedisDel.mockResolvedValue(1);

    mockGetPlayerLoadout.mockResolvedValue(makeMockLoadout());
    mockGetHenrikAccount.mockResolvedValue(makeMockAccount());
    mockGetHenrikMMR.mockResolvedValue(makeMockMMR());
    mockGetPlayerCardByUuid.mockResolvedValue({ smallArt: "", wideArt: "", largeArt: "" });
    mockGetPlayerTitleByUuid.mockResolvedValue({ titleText: "Title" });
    mockGetCompetitiveTierIconByTier.mockResolvedValue("https://ranked.icon");

    const result = await getProfileData(makeTokens(), "na");

    // Should fall through to API fetch since cache read failed
    expect(mockGetPlayerLoadout).toHaveBeenCalled();
    expect(result.partial).toBe(false);
    // A Redis outage degrades every profile fetch — it must leave a signal.
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining("Profile cache read failed"),
      expect.anything(),
    );
  });

  it("Tier 1: loadout fails, Henrik succeeds → partial:false, henrikFailed:false", async () => {
    mockRedisGet.mockResolvedValue(null);

    mockGetPlayerLoadout.mockRejectedValue(new Error("Riot timeout"));
    mockGetHenrikAccount.mockResolvedValue(makeMockAccount({ name: "OnlyHenrik", tag: "TAG1" }));
    mockGetHenrikMMR.mockResolvedValue(makeMockMMR());
    mockGetCompetitiveTierIconByTier.mockResolvedValue("https://ranked.icon");

    const result = await getProfileData(makeTokens(), "na");

    expect(result.partial).toBe(false);
    expect(result.henrikFailed).toBe(false);
    expect(result.playerCardId).toBeUndefined();
    expect(result.henrikName).toBe("OnlyHenrik");
  });

  it("Tier 1: Henrik account fails → henrikFailed:true, still partial:false if loadout succeeded", async () => {
    mockRedisGet.mockResolvedValue(null);

    mockGetPlayerLoadout.mockResolvedValue(makeMockLoadout());
    mockGetHenrikAccount.mockRejectedValue(new Error("Henrik down"));
    mockGetHenrikMMR.mockResolvedValue(makeMockMMR());
    mockGetPlayerCardByUuid.mockResolvedValue({ smallArt: "", wideArt: "", largeArt: "" });
    mockGetPlayerTitleByUuid.mockResolvedValue({ titleText: "Title" });
    mockGetCompetitiveTierIconByTier.mockResolvedValue("https://ranked.icon");

    const result = await getProfileData(makeTokens(), "na");

    expect(result.partial).toBe(false);
    expect(result.henrikFailed).toBe(true);
  });
});

describe("getProfileData — Tier 2 (stale-while-revalidate)", () => {
  it("Tier 2: all APIs fail + stale cache exists → returns stale data with fromCache:true", async () => {
    const staleProfile: ProfileData = {
      playerCardId: "stale-card",
      fromCache: false,
      partial: false,
      henrikFailed: false,
    };
    mockRedisGet.mockResolvedValue(makeCacheEntry(staleProfile, Date.now() - 3600000)); // stale entry

    mockGetPlayerLoadout.mockRejectedValue(new Error("Riot down"));
    mockGetHenrikAccount.mockRejectedValue(new Error("Henrik down"));
    mockGetHenrikMMR.mockRejectedValue(new Error("MMR down"));

    const result = await getProfileData(makeTokens(), "na");

    expect(result.fromCache).toBe(true);
    expect(result.partial).toBe(false); // got stale data
  });

  it("Tier 2: all APIs fail + malformed stale cache → falls through to Tier 3", async () => {
    mockRedisGet.mockResolvedValue("{malformed");
    mockRedisDel.mockResolvedValue(1);

    mockGetPlayerLoadout.mockRejectedValue(new Error("Riot down"));
    mockGetHenrikAccount.mockRejectedValue(new Error("Henrik down"));
    mockGetHenrikMMR.mockRejectedValue(new Error("MMR down"));

    const result = await getProfileData(makeTokens(), "na");

    // Falls through to Tier 3
    expect(result.partial).toBe(true);
    expect(result.henrikFailed).toBe(true);
  });
});

describe("getProfileData — Tier 3 (total failure)", () => {
  it("Tier 3: all APIs fail + no cache → returns partial:true, henrikFailed:true", async () => {
    mockRedisGet.mockResolvedValue(null);

    mockGetPlayerLoadout.mockRejectedValue(new Error("Riot down"));
    mockGetHenrikAccount.mockRejectedValue(new Error("Henrik down"));
    mockGetHenrikMMR.mockRejectedValue(new Error("MMR down"));

    const result = await getProfileData(makeTokens(), "na");

    expect(result.partial).toBe(true);
    expect(result.henrikFailed).toBe(true);
    expect(mockRedisSet).not.toHaveBeenCalled(); // partial data not cached
  });
});

describe("getProfileData — Redis failures never leak a PUUID nor fail the request", () => {
  // @upstash/redis builds its message as `${body.error}, command was: ${JSON.stringify(req.body)}`,
  // so the failing command — and with it the full key — is inside error.message.
  const FULL_PUUID = "0e6ab3a5-2b1c-4f9d-9a7e-1c2d3e4f5a6b";

  function loggedText() {
    return mockLogWarn.mock.calls.flat().map((arg) => String(arg)).join(" ");
  }

  beforeEach(() => {
    mockGetPlayerLoadout.mockResolvedValue(makeMockLoadout());
    mockGetHenrikAccount.mockResolvedValue(makeMockAccount());
    mockGetHenrikMMR.mockResolvedValue(makeMockMMR());
    mockGetPlayerCardByUuid.mockResolvedValue({ smallArt: "", wideArt: "", largeArt: "" });
    mockGetPlayerTitleByUuid.mockResolvedValue({ titleText: "Test Title" });
    mockGetCompetitiveTierIconByTier.mockResolvedValue("https://ranked.icon");
  });

  it("a failed cache read still warns, but with the truncated PUUID only", async () => {
    // UpstashError is what @upstash/redis actually throws, and its name is the
    // only part of it the log is allowed to carry.
    const upstashError = new Error(`WRONGPASS invalid credentials, command was: ["get","profile:${FULL_PUUID}"]`);
    upstashError.name = "UpstashError";
    mockRedisGet.mockRejectedValue(upstashError);

    const result = await getProfileData(makeTokens(FULL_PUUID), "na");

    expect(result.partial).toBe(false);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining("Profile cache read failed"),
      expect.anything(),
    );
    expect(loggedText()).not.toContain(FULL_PUUID);
    expect(loggedText()).toContain(FULL_PUUID.substring(0, 8));
    expect(loggedText()).toContain("UpstashError");
  });

  it("a failed cache write does not fail a request whose data was already fetched", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockRejectedValue(
      new Error(`ERR max daily request limit exceeded, command was: ["set","profile:${FULL_PUUID}"]`),
    );

    const result = await getProfileData(makeTokens(FULL_PUUID), "na");

    expect(result.partial).toBe(false);
    expect(result.henrikName).toBe("TestPlayer");
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining("Profile cache write failed"),
      expect.anything(),
    );
    expect(loggedText()).not.toContain(FULL_PUUID);
  });

  it("a rejection that is not an Error is still logged without the full PUUID", async () => {
    mockRedisGet.mockRejectedValue(`ERR unauthenticated, command was: ["get","profile:${FULL_PUUID}"]`);

    const result = await getProfileData(makeTokens(FULL_PUUID), "na");

    expect(result.partial).toBe(false);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining("Profile cache read failed"),
      expect.anything(),
    );
    expect(loggedText()).not.toContain(FULL_PUUID);
  });

  it("a failed delete of a malformed entry does not fail the request", async () => {
    mockRedisGet.mockResolvedValue("{invalid-json");
    mockRedisDel.mockRejectedValue(
      new Error(`READONLY You can't write against a read only replica, command was: ["del","profile:${FULL_PUUID}"]`),
    );

    const result = await getProfileData(makeTokens(FULL_PUUID), "na");

    expect(result.partial).toBe(false);
    expect(mockGetPlayerLoadout).toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining("Malformed cache entry cleanup failed"),
      expect.anything(),
    );
    expect(loggedText()).not.toContain(FULL_PUUID);
  });
});

describe("clearProfileCache", () => {
  it("with puuid: calls redis.del with correct key", async () => {
    await clearProfileCache("test-puuid");

    expect(mockRedisDel).toHaveBeenCalledWith("profile:test-puuid");
  });

  it("without puuid: scans and deletes all profile keys", async () => {
    mockRedisScan
      .mockResolvedValueOnce(["5", ["profile:puuid1", "profile:puuid2"]])
      .mockResolvedValueOnce(["0", ["profile:puuid3"]]);

    await clearProfileCache();

    expect(mockRedisScan).toHaveBeenCalled();
    expect(mockRedisDel).toHaveBeenCalledTimes(3);
    expect(mockRedisDel).toHaveBeenCalledWith("profile:puuid1");
    expect(mockRedisDel).toHaveBeenCalledWith("profile:puuid2");
    expect(mockRedisDel).toHaveBeenCalledWith("profile:puuid3");
  });
});


describe("getProfileData — competitive extras from Henrik MMR", () => {
  beforeEach(() => {
    mockRedisGet.mockResolvedValue(null);
    mockGetPlayerLoadout.mockResolvedValue(makeMockLoadout());
    mockGetHenrikAccount.mockResolvedValue(makeMockAccount());
    mockGetPlayerCardByUuid.mockResolvedValue({ smallArt: "", wideArt: "", largeArt: "" });
    mockGetPlayerTitleByUuid.mockResolvedValue({ titleText: "Test Title" });
    mockGetCompetitiveTierIconByTier.mockResolvedValue("https://ranked.icon");
  });

  it("maps peak act, placement games, leaderboard rank and the act history (newest first, empty acts dropped)", async () => {
    mockGetHenrikMMR.mockResolvedValue(
      makeMockMMR({
        current: {
          tier: { id: 10, name: "Gold 1" },
          rr: 55,
          last_change: 12,
          games_needed_for_rating: 0,
          leaderboard_placement: { rank: 9001 },
        },
        peak: { tier: { id: 12, name: "Platinum 1" }, season: { id: "e7a2", short: "e7a2" } },
        seasonal: [
          { season: { id: "e7a2", short: "e7a2" }, wins: 20, games: 40, end_tier: { id: 12, name: "Platinum 1" }, end_rr: 30 },
          { season: { id: "e6a3", short: "e6a3" }, wins: 0, games: 0, end_tier: null, end_rr: null },
          { season: { id: "e8a1", short: "e8a1" }, wins: 5, games: 12, end_tier: { id: 10, name: "Gold 1" }, end_rr: 55 },
        ],
      }),
    );

    const result = await getProfileData(makeTokens(), "na");

    expect(result.mmrChangeToLastGame).toBe(12);
    expect(result.peakSeason).toBe("e7a2");
    expect(result.gamesNeededForRating).toBe(0);
    expect(result.leaderboardRank).toBe(9001);
    expect(result.actHistory).toEqual([
      { season: "e8a1", wins: 5, games: 12, endTier: 10, endTierName: "Gold 1", endRR: 55 },
      { season: "e7a2", wins: 20, games: 40, endTier: 12, endTierName: "Platinum 1", endRR: 30 },
    ]);
  });

  it("leaves the extras undefined when Henrik returns no seasonal data", async () => {
    mockGetHenrikMMR.mockResolvedValue(makeMockMMR());

    const result = await getProfileData(makeTokens(), "na");

    expect(result.actHistory).toBeUndefined();
    expect(result.peakSeason).toBeUndefined();
    expect(result.leaderboardRank).toBeUndefined();
  });
});


describe("getProfileData — cache entry version", () => {
  const OLD_PROFILE: ProfileData = { playerCardId: "card-old", fromCache: false, partial: false, henrikFailed: false };

  beforeEach(() => {
    mockGetPlayerLoadout.mockResolvedValue(makeMockLoadout());
    mockGetHenrikAccount.mockResolvedValue(makeMockAccount());
    mockGetHenrikMMR.mockResolvedValue(makeMockMMR());
    mockGetPlayerCardByUuid.mockResolvedValue({ smallArt: "", wideArt: "", largeArt: "" });
    mockGetPlayerTitleByUuid.mockResolvedValue({ titleText: "Test Title" });
    mockGetCompetitiveTierIconByTier.mockResolvedValue("https://ranked.icon");
  });

  it.each([
    { name: "no version key (written before versioning)", version: null },
    { name: "an older version number", version: PROFILE_CACHE_VERSION - 1 },
  ])("a fresh entry with $name is refetched and rewritten with the current version", async ({ version }) => {
    mockRedisGet.mockResolvedValue(makeCacheEntry(OLD_PROFILE, Date.now() - 60_000, version));

    const result = await getProfileData(makeTokens(), "na");

    expect(mockGetHenrikMMR).toHaveBeenCalled();
    expect(result.fromCache).toBe(false);
    const written = JSON.parse(mockRedisSet.mock.calls[0]![1] as string);
    expect(written.version).toBe(PROFILE_CACHE_VERSION);
  });

  it("a fresh entry with the current version is served from cache", async () => {
    mockRedisGet.mockResolvedValue(makeCacheEntry(OLD_PROFILE));

    const result = await getProfileData(makeTokens(), "na");

    expect(mockGetHenrikMMR).not.toHaveBeenCalled();
    expect(result.fromCache).toBe(true);
  });

  it("an older-version entry still serves as the stale fallback when every source fails", async () => {
    mockRedisGet.mockResolvedValue(makeCacheEntry(OLD_PROFILE, Date.now() - 60_000, null));
    mockGetPlayerLoadout.mockResolvedValue(null);
    mockGetHenrikAccount.mockResolvedValue(null);
    mockGetHenrikMMR.mockResolvedValue(null);

    const result = await getProfileData(makeTokens(), "na");

    expect(result.fromCache).toBe(true);
    expect(result.playerCardId).toBe("card-old");
  });
});


describe("getProfileData — recent competitive matches", () => {
  beforeEach(() => {
    mockRedisGet.mockResolvedValue(null);
    mockGetPlayerLoadout.mockResolvedValue(makeMockLoadout());
    mockGetHenrikAccount.mockResolvedValue(makeMockAccount());
    mockGetHenrikMMR.mockResolvedValue(makeMockMMR());
    mockGetPlayerCardByUuid.mockResolvedValue({ smallArt: "", wideArt: "", largeArt: "" });
    mockGetPlayerTitleByUuid.mockResolvedValue({ titleText: "Test Title" });
    mockGetCompetitiveTierIconByTier.mockResolvedValue("https://ranked.icon");
  });

  it("shapes and aggregates stored matches into recentMatches and matchStats", async () => {
    mockGetHenrikStoredMatches.mockResolvedValue([
      {
        meta: { id: "m1", map: { id: "map", name: "Bind" }, started_at: "2026-09-20T10:00:00Z" },
        stats: {
          team: "Blue", character: { id: "agent-1", name: "Reyna" }, score: 5000,
          kills: 22, deaths: 11, assists: 4, shots: { head: 20, body: 20, leg: 0 }, damage: { dealt: 3300, received: 2000 },
        },
        teams: { red: 9, blue: 13 },
      },
    ]);

    const result = await getProfileData(makeTokens(), "na");

    expect(result.recentMatches).toHaveLength(1);
    expect(result.recentMatches![0]).toMatchObject({ id: "m1", map: "Bind", agent: "Reyna", result: "win", roundsWon: 13, roundsLost: 9, headshotPct: 50 });
    expect(result.matchStats).toMatchObject({ games: 1, wins: 1, winRate: 100, kd: 2, form: ["win"] });
    expect(result.henrikFailed).toBe(false);
  });

  it("a matches failure leaves the fields undefined and does not mark Henrik as failed", async () => {
    mockGetHenrikStoredMatches.mockRejectedValue(new Error("boom"));

    const result = await getProfileData(makeTokens(), "na");

    expect(result.recentMatches).toBeUndefined();
    expect(result.matchStats).toBeUndefined();
    expect(result.henrikFailed).toBe(false);
  });
});
