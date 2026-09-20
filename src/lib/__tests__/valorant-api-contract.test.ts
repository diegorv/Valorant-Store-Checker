/**
 * valorant-api.ts — request and cache contract.
 *
 * valorant-api.test.ts covers what each function *returns*. These cover what it
 * does on the way there: which URL it calls, which key it caches under, what it
 * writes, and when it refuses to trust a response. None of that was asserted, so
 * the module could have fetched the wrong endpoint, cached under the wrong key,
 * or written entries with no expiry, with every existing test still green.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();

vi.mock("@/lib/redis-client", () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const {
  getWeaponSkins,
  getContentTiers,
  getBundles,
  getPlayerCardByUuid,
  getPlayerTitleByUuid,
  getSkinLevelByUuid,
  getBuddyLevelByUuid,
  getSprayByUuid,
  getSprayLevelByUuid,
  getCompetitiveTierIconByTier,
  getWeaponSkinsByUuids,
  getWeaponSkinsByLevelUuids,
  _resetSkinsCache,
  _resetTiersCache,
} = await import("@/lib/valorant-api");

const BASE = "https://valorant-api.com/v1";
const DAY_SECONDS = 24 * 60 * 60;

const SKIN = {
  uuid: "skin-1",
  displayName: "Vandal",
  themeUuid: "theme-1",
  contentTierUuid: null,
  displayIcon: "icon.png",
  wallpaper: null,
  assetPath: "Skins/Skin-1",
  levels: [
    {
      uuid: "level-1",
      displayName: "Vandal Standard",
      levelItem: null,
      displayIcon: "level-icon.png",
      streamedVideo: null,
      assetPath: "Levels/Level-1",
    },
  ],
  chromas: [
    {
      uuid: "chroma-1",
      displayName: "Vandal Red",
      displayIcon: "chroma-icon.png",
      fullRender: "full-render.png",
      swatch: "swatch.png",
      streamedVideo: null,
      assetPath: "Chromas/Chroma-1",
    },
  ],
};

const TIER = {
  uuid: "tier-1",
  displayName: "Select",
  devName: "Select",
  rank: 1,
  juiceValue: 0,
  juiceCost: 0,
  highlightColor: "#ffffff",
  displayIcon: "tier-icon.png",
  assetPath: "Tiers/Tier-1",
};

const BUNDLE = {
  uuid: "bundle-1",
  displayName: "Premium Bundle",
  displayNameSubText: null,
  description: null,
  extraDescription: null,
  promoDescription: null,
  useAdditionalContext: false,
  displayIcon: "bundle.png",
  displayIcon2: "bundle2.png",
  verticalPromoImage: null,
  assetPath: "Bundles/Bundle-1",
};

const PLAYER_CARD = {
  uuid: "card-1",
  displayName: "Card",
  isHiddenIfNotOwned: false,
  themeUuid: null,
  displayIcon: null,
  smallArt: "small.png",
  wideArt: "wide.png",
  largeArt: "large.png",
  assetPath: "Cards/Card-1",
};

const PLAYER_TITLE = {
  uuid: "title-1",
  displayName: "Title",
  titleText: "The Title",
  isHiddenIfNotOwned: false,
  assetPath: "Titles/Title-1",
};

const SKIN_LEVEL = {
  uuid: "level-1",
  displayName: "Vandal Standard",
  levelItem: null,
  displayIcon: "level-icon.png",
  streamedVideo: null,
  assetPath: "Levels/Level-1",
};

const BUDDY_LEVEL = {
  uuid: "buddy-1",
  charmLevel: 1,
  displayName: "Buddy",
  displayIcon: "buddy.png",
  assetPath: "Buddies/Buddy-1",
};

const SPRAY = {
  uuid: "spray-1",
  displayName: "Spray",
  category: null,
  themeUuid: null,
  isNullSpray: false,
  displayIcon: "spray.png",
  fullIcon: null,
  fullTransparentIcon: null,
  animationPng: null,
  animationGif: null,
  assetPath: "Sprays/Spray-1",
};

const SPRAY_LEVEL = {
  uuid: "spraylevel-1",
  sprayLevel: 1,
  displayName: "Spray Level",
  displayIcon: "spraylevel.png",
  assetPath: "SprayLevels/SprayLevel-1",
};

const COMPETITIVE = [
  {
    uuid: "season-1",
    tiers: [
      { tier: 0, largeIcon: null },
      { tier: 24, largeIcon: "https://ranked/radiant.png" },
    ],
  },
];

function ok(data: unknown, status = 200) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ status, data }),
  };
}

/** A transport-level failure that still carries a perfectly valid body. */
function notOkButValidBody(data: unknown) {
  return {
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    json: async () => ({ status: 200, data }),
  };
}

function fetchMock(response: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(response as Response);
}

/** The single URL that was fetched. */
function fetchedUrl(spy: ReturnType<typeof fetchMock>): string {
  expect(spy).toHaveBeenCalledTimes(1);
  return String(spy.mock.calls[0]![0]);
}

beforeEach(() => {
  mockRedisGet.mockReset();
  mockRedisSet.mockReset();
  vi.restoreAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue("OK");
  _resetSkinsCache();
  _resetTiersCache();
});

// ---------------------------------------------------------------------------
// Which endpoint each function calls
// ---------------------------------------------------------------------------

describe("endpoints", () => {
  it("getWeaponSkins fetches the skins list", async () => {
    const spy = fetchMock(ok([SKIN]));
    await getWeaponSkins();
    expect(fetchedUrl(spy)).toBe(`${BASE}/weapons/skins`);
  });

  it("getContentTiers fetches the content tiers list", async () => {
    const spy = fetchMock(ok([TIER]));
    await getContentTiers();
    expect(fetchedUrl(spy)).toBe(`${BASE}/contenttiers`);
  });

  it("getBundles fetches the bundles list", async () => {
    const spy = fetchMock(ok([BUNDLE]));
    await getBundles();
    expect(fetchedUrl(spy)).toBe(`${BASE}/bundles`);
  });

  it("getPlayerCardByUuid fetches that card", async () => {
    const spy = fetchMock(ok(PLAYER_CARD));
    await getPlayerCardByUuid("card-1");
    expect(fetchedUrl(spy)).toBe(`${BASE}/playercards/card-1`);
  });

  it("getPlayerTitleByUuid fetches that title", async () => {
    const spy = fetchMock(ok(PLAYER_TITLE));
    await getPlayerTitleByUuid("title-1");
    expect(fetchedUrl(spy)).toBe(`${BASE}/playertitles/title-1`);
  });

  it("getSkinLevelByUuid fetches that skin level", async () => {
    const spy = fetchMock(ok(SKIN_LEVEL));
    await getSkinLevelByUuid("level-1");
    expect(fetchedUrl(spy)).toBe(`${BASE}/weapons/skinlevels/level-1`);
  });

  it("getBuddyLevelByUuid fetches that buddy level", async () => {
    const spy = fetchMock(ok(BUDDY_LEVEL));
    await getBuddyLevelByUuid("buddy-1");
    expect(fetchedUrl(spy)).toBe(`${BASE}/buddies/levels/buddy-1`);
  });

  it("getSprayByUuid fetches that spray", async () => {
    const spy = fetchMock(ok(SPRAY));
    await getSprayByUuid("spray-1");
    expect(fetchedUrl(spy)).toBe(`${BASE}/sprays/spray-1`);
  });

  it("getSprayLevelByUuid fetches that spray level", async () => {
    const spy = fetchMock(ok(SPRAY_LEVEL));
    await getSprayLevelByUuid("spraylevel-1");
    expect(fetchedUrl(spy)).toBe(`${BASE}/sprays/levels/spraylevel-1`);
  });

  it("getCompetitiveTierIconByTier fetches the competitive season table", async () => {
    const spy = fetchMock(ok(COMPETITIVE));
    await getCompetitiveTierIconByTier(24);
    expect(fetchedUrl(spy)).toBe(`${BASE}/competitivetiers`);
  });
});

// ---------------------------------------------------------------------------
// What gets written to Redis
// ---------------------------------------------------------------------------

describe("cache writes", () => {
  it("stores the skins list under its key, with a timestamp and a 24h expiry", async () => {
    fetchMock(ok([SKIN]));
    const before = Date.now();
    await getWeaponSkins();
    const after = Date.now();

    expect(mockRedisSet).toHaveBeenCalledTimes(1);
    const [key, payload, options] = mockRedisSet.mock.calls[0]!;

    expect(key).toBe("valorant:skins");
    // Without `ex` the entry never expires and the game data goes permanently stale.
    expect(options).toEqual({ ex: DAY_SECONDS });

    const written = JSON.parse(payload as string);
    expect(written.data).toEqual([SKIN]);
    expect(written.timestamp).toBeGreaterThanOrEqual(before);
    expect(written.timestamp).toBeLessThanOrEqual(after);
  });

  it.each([
    ["getContentTiers", () => getContentTiers(), [TIER], "valorant:tiers"],
    ["getBundles", () => getBundles(), [BUNDLE], "valorant:bundles"],
  ])("%s caches under %s", async (_name, call, data, key) => {
    fetchMock(ok(data));
    await call();

    expect(mockRedisSet).toHaveBeenCalledTimes(1);
    expect(mockRedisSet.mock.calls[0]![0]).toBe(key);
    expect(mockRedisSet.mock.calls[0]![2]).toEqual({ ex: DAY_SECONDS });
  });

  it.each([
    [
      "getSkinLevelByUuid",
      () => getSkinLevelByUuid("level-1"),
      SKIN_LEVEL,
      "valorant:skinlevel:level-1",
    ],
    [
      "getBuddyLevelByUuid",
      () => getBuddyLevelByUuid("buddy-1"),
      BUDDY_LEVEL,
      "valorant:buddylevel:buddy-1",
    ],
    ["getSprayByUuid", () => getSprayByUuid("spray-1"), SPRAY, "valorant:spray:spray-1"],
    [
      "getSprayLevelByUuid",
      () => getSprayLevelByUuid("spraylevel-1"),
      SPRAY_LEVEL,
      "valorant:spraylevel:spraylevel-1",
    ],
  ])("%s caches under a per-uuid key", async (_name, call, data, key) => {
    fetchMock(ok(data));
    await call();

    expect(mockRedisGet).toHaveBeenCalledWith(key);
    expect(mockRedisSet).toHaveBeenCalledTimes(1);
    expect(mockRedisSet.mock.calls[0]![0]).toBe(key);
  });
});

// ---------------------------------------------------------------------------
// Refusing to trust a response
//
// These distinguish "returned null" from "returned null for the right reason".
// A response that fails the transport check but carries a valid body must still
// be rejected — otherwise the guard could be removed unnoticed.
// ---------------------------------------------------------------------------

describe("rejects responses that should not be trusted", () => {
  it.each([
    ["getPlayerCardByUuid", () => getPlayerCardByUuid("card-1"), PLAYER_CARD],
    ["getPlayerTitleByUuid", () => getPlayerTitleByUuid("title-1"), PLAYER_TITLE],
    ["getSkinLevelByUuid", () => getSkinLevelByUuid("level-1"), SKIN_LEVEL],
    ["getBuddyLevelByUuid", () => getBuddyLevelByUuid("buddy-1"), BUDDY_LEVEL],
    ["getSprayByUuid", () => getSprayByUuid("spray-1"), SPRAY],
    ["getSprayLevelByUuid", () => getSprayLevelByUuid("spraylevel-1"), SPRAY_LEVEL],
  ])("%s returns null on an HTTP error even when the body is valid", async (_n, call, data) => {
    fetchMock(notOkButValidBody(data));
    await expect(call()).resolves.toBeNull();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it.each([
    ["getPlayerCardByUuid", () => getPlayerCardByUuid("card-1"), PLAYER_CARD],
    ["getPlayerTitleByUuid", () => getPlayerTitleByUuid("title-1"), PLAYER_TITLE],
    ["getSkinLevelByUuid", () => getSkinLevelByUuid("level-1"), SKIN_LEVEL],
    ["getBuddyLevelByUuid", () => getBuddyLevelByUuid("buddy-1"), BUDDY_LEVEL],
    ["getSprayByUuid", () => getSprayByUuid("spray-1"), SPRAY],
    ["getSprayLevelByUuid", () => getSprayLevelByUuid("spraylevel-1"), SPRAY_LEVEL],
  ])("%s returns null when the body reports a non-200 status", async (_n, call, data) => {
    fetchMock(ok(data, 404));
    await expect(call()).resolves.toBeNull();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it("getWeaponSkins throws on an HTTP error even when the body is valid", async () => {
    fetchMock(notOkButValidBody([SKIN]));
    await expect(getWeaponSkins()).rejects.toThrow(/500/);
  });

  it("getWeaponSkins throws when the body reports a non-200 status", async () => {
    fetchMock(ok([SKIN], 500));
    await expect(getWeaponSkins()).rejects.toThrow(/status 500/);
  });
});

// ---------------------------------------------------------------------------
// TTL boundary
// ---------------------------------------------------------------------------

describe("cache expiry boundary", () => {
  // The module compares the entry's timestamp against its own Date.now(). With
  // real time, a millisecond can tick between building the entry here and that
  // comparison, turning "exactly at the TTL" into "one past it" (CI flake).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves an entry that is exactly 24h old", async () => {
    const spy = fetchMock(ok([SKIN]));
    mockRedisGet.mockResolvedValue(
      JSON.stringify({ data: [SKIN], timestamp: Date.now() - DAY_SECONDS * 1000 }),
    );

    await getWeaponSkins();
    // Exactly at the TTL is still valid — the check is strictly greater-than.
    expect(spy).not.toHaveBeenCalled();
  });

  it("refetches an entry that is one millisecond past 24h", async () => {
    const spy = fetchMock(ok([SKIN]));
    mockRedisGet.mockResolvedValue(
      JSON.stringify({ data: [SKIN], timestamp: Date.now() - DAY_SECONDS * 1000 - 1 }),
    );

    await getWeaponSkins();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The module-level lookup maps
// ---------------------------------------------------------------------------

describe("skin lookup maps", () => {
  it("resolves a chroma UUID back to its parent skin", async () => {
    fetchMock(ok([SKIN]));
    await getWeaponSkins();

    // Entitlements hand back chroma ItemIDs, which are neither a level nor a
    // skin UUID; getWeaponSkinsByLevelUuids falls back to the chroma map.
    const found = await getWeaponSkinsByLevelUuids(["chroma-1"]);
    expect(found.get("chroma-1")?.uuid).toBe("skin-1");
  });

  it("resolves chroma, level and skin UUIDs regardless of case", async () => {
    fetchMock(ok([SKIN]));
    await getWeaponSkins();

    const byChroma = await getWeaponSkinsByLevelUuids(["CHROMA-1"]);
    const byLevel = await getWeaponSkinsByLevelUuids(["LEVEL-1"]);
    const bySkin = await getWeaponSkinsByUuids(["SKIN-1"]);

    expect(byChroma.get("chroma-1")?.uuid).toBe("skin-1");
    expect(byLevel.get("level-1")?.uuid).toBe("skin-1");
    expect(bySkin.get("skin-1")?.uuid).toBe("skin-1");
  });

  it("drops entries from a previous load rather than accumulating them", async () => {
    fetchMock(ok([SKIN]));
    await getWeaponSkins();
    expect((await getWeaponSkinsByUuids(["skin-1"])).size).toBe(1);

    _resetSkinsCache();
    vi.restoreAllMocks();
    mockRedisGet.mockResolvedValue(null);
    const OTHER = { ...SKIN, uuid: "skin-2", levels: [], chromas: [] };
    fetchMock(ok([OTHER]));
    await getWeaponSkins();

    // skin-1 came from the first load; leaving it behind would serve stale art.
    expect((await getWeaponSkinsByUuids(["skin-1"])).size).toBe(0);
    expect((await getWeaponSkinsByUuids(["skin-2"])).size).toBe(1);
  });

  it("indexes a skin that has an empty chroma list", async () => {
    // The `?? []` guards in getWeaponSkins cannot be reached with a missing
    // `chromas` — the schema rejects that first — but an empty array is valid.
    const noChromas = { ...SKIN, uuid: "skin-3", chromas: [] };
    fetchMock(ok([noChromas]));

    await expect(getWeaponSkins()).resolves.toHaveLength(1);
    expect((await getWeaponSkinsByUuids(["skin-3"])).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getSprayLevelByUuid — had no tests of its own
// ---------------------------------------------------------------------------

describe("getSprayLevelByUuid", () => {
  it("returns the cached level without fetching", async () => {
    const spy = fetchMock(ok(SPRAY_LEVEL));
    mockRedisGet.mockResolvedValue(
      JSON.stringify({ data: SPRAY_LEVEL, timestamp: Date.now() }),
    );

    await expect(getSprayLevelByUuid("spraylevel-1")).resolves.toEqual(SPRAY_LEVEL);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the fetched level and caches it", async () => {
    fetchMock(ok(SPRAY_LEVEL));
    await expect(getSprayLevelByUuid("spraylevel-1")).resolves.toEqual(SPRAY_LEVEL);
    expect(mockRedisSet).toHaveBeenCalledTimes(1);
  });

  it("returns null when the body carries no data", async () => {
    fetchMock(ok(null));
    await expect(getSprayLevelByUuid("spraylevel-1")).resolves.toBeNull();
  });

  it("returns null when the payload does not match the schema", async () => {
    fetchMock(ok({ uuid: "spraylevel-1" }));
    await expect(getSprayLevelByUuid("spraylevel-1")).resolves.toBeNull();
  });

  it("falls back to expired cache when the fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    mockRedisGet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        JSON.stringify({ data: SPRAY_LEVEL, timestamp: 0 }),
      );

    await expect(getSprayLevelByUuid("spraylevel-1")).resolves.toEqual(SPRAY_LEVEL);
  });

  it("returns null when the fetch throws and there is no stale cache", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(getSprayLevelByUuid("spraylevel-1")).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Request options
//
// `cache: "no-store"` and the abort signal are the difference between a live
// asset list and whatever the platform decided to keep. Nothing asserted them.
// ---------------------------------------------------------------------------

describe("request options", () => {
  function initOf(spy: ReturnType<typeof fetchMock>) {
    expect(spy).toHaveBeenCalledTimes(1);
    return spy.mock.calls[0]![1] as RequestInit & { next?: unknown };
  }

  it.each([
    ["getWeaponSkins", () => getWeaponSkins(), [SKIN]],
    ["getContentTiers", () => getContentTiers(), [TIER]],
    ["getBundles", () => getBundles(), [BUNDLE]],
    ["getSkinLevelByUuid", () => getSkinLevelByUuid("level-1"), SKIN_LEVEL],
    ["getBuddyLevelByUuid", () => getBuddyLevelByUuid("buddy-1"), BUDDY_LEVEL],
    ["getSprayByUuid", () => getSprayByUuid("spray-1"), SPRAY],
    ["getSprayLevelByUuid", () => getSprayLevelByUuid("spraylevel-1"), SPRAY_LEVEL],
  ])("%s asks for JSON, bypasses the fetch cache and sets a timeout", async (_n, call, data) => {
    const spy = fetchMock(ok(data));
    await call();
    const init = initOf(spy);

    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["getPlayerCardByUuid", () => getPlayerCardByUuid("card-1"), PLAYER_CARD],
    ["getPlayerTitleByUuid", () => getPlayerTitleByUuid("title-1"), PLAYER_TITLE],
  ])("%s revalidates daily through Next's fetch cache", async (_n, call, data) => {
    const spy = fetchMock(ok(data));
    await call();
    const init = initOf(spy);

    // These two go through Next's cache rather than no-store; dropping the
    // revalidate window would pin the asset forever.
    expect(init.next).toEqual({ revalidate: 86400 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("getCompetitiveTierIconByTier revalidates daily", async () => {
    const spy = fetchMock(ok(COMPETITIVE));
    await getCompetitiveTierIconByTier(24);
    const init = initOf(spy);

    expect(init.next).toEqual({ revalidate: 86400 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// ---------------------------------------------------------------------------
// getCompetitiveTierIconByTier
// ---------------------------------------------------------------------------

describe("getCompetitiveTierIconByTier", () => {
  it("reads the tier table from the most recent season, not the first", async () => {
    const older = {
      uuid: "season-0",
      tiers: [{ tier: 24, largeIcon: "https://ranked/old-radiant.png" }],
    };
    fetchMock(ok([older, ...COMPETITIVE]));

    await expect(getCompetitiveTierIconByTier(24)).resolves.toBe(
      "https://ranked/radiant.png",
    );
  });

  it("returns null for a tier the season does not list", async () => {
    fetchMock(ok(COMPETITIVE));
    await expect(getCompetitiveTierIconByTier(99)).resolves.toBeNull();
  });

  it("returns null when the tier exists but has no icon", async () => {
    fetchMock(ok(COMPETITIVE));
    // Unranked (0) is a real tier with a null icon — distinct from an absent one.
    await expect(getCompetitiveTierIconByTier(0)).resolves.toBeNull();
  });

  it("returns null when the season list comes back empty", async () => {
    fetchMock(ok([]));
    await expect(getCompetitiveTierIconByTier(24)).resolves.toBeNull();
  });

  it("returns null when the payload does not match the schema", async () => {
    fetchMock(ok([{ uuid: "season-1" }]));
    await expect(getCompetitiveTierIconByTier(24)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getSkinVideo
// ---------------------------------------------------------------------------

describe("getSkinVideo", () => {
  function skinWithLevels(videos: Array<string | null>) {
    return {
      ...SKIN,
      levels: videos.map((streamedVideo, i) => ({
        uuid: `level-${i}`,
        displayName: `Level ${i}`,
        levelItem: null,
        displayIcon: null,
        streamedVideo,
        assetPath: `Levels/Level-${i}`,
      })),
    } as never;
  }

  it("returns the video from the highest level that has one", async () => {
    const { getSkinVideo } = await import("@/lib/valorant-api");
    // Walking forwards would return the level 1 video instead.
    expect(getSkinVideo(skinWithLevels(["low.mp4", null, "high.mp4"]))).toBe("high.mp4");
  });

  it("reaches the first level when it is the only one with a video", async () => {
    const { getSkinVideo } = await import("@/lib/valorant-api");
    // An off-by-one in the loop bound would skip index 0.
    expect(getSkinVideo(skinWithLevels(["only.mp4", null, null]))).toBe("only.mp4");
  });

  it("reaches the last level when it is the only one with a video", async () => {
    const { getSkinVideo } = await import("@/lib/valorant-api");
    expect(getSkinVideo(skinWithLevels([null, null, "last.mp4"]))).toBe("last.mp4");
  });

  it("returns null for an empty level list", async () => {
    const { getSkinVideo } = await import("@/lib/valorant-api");
    expect(getSkinVideo(skinWithLevels([]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A payload that fails validation must not reach the cache
//
// Returning null is not enough: without the guard the module caches the null
// and serves it for 24 hours.
// ---------------------------------------------------------------------------

describe("does not cache a payload that fails validation", () => {
  it.each([
    ["getSkinLevelByUuid", () => getSkinLevelByUuid("level-1")],
    ["getBuddyLevelByUuid", () => getBuddyLevelByUuid("buddy-1")],
    ["getSprayByUuid", () => getSprayByUuid("spray-1")],
    ["getSprayLevelByUuid", () => getSprayLevelByUuid("spraylevel-1")],
  ])("%s", async (_name, call) => {
    fetchMock(ok({ uuid: "present-but-incomplete" }));

    await expect(call()).resolves.toBeNull();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });
});

describe("getCompetitiveTierIconByTier — untrusted responses", () => {
  it("returns null on an HTTP error even when the body is valid", async () => {
    fetchMock(notOkButValidBody(COMPETITIVE));
    await expect(getCompetitiveTierIconByTier(24)).resolves.toBeNull();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it("does not cache a season table that fails validation", async () => {
    fetchMock(ok([{ uuid: "season-1" }]));
    await expect(getCompetitiveTierIconByTier(24)).resolves.toBeNull();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it("caches the season table it just fetched", async () => {
    fetchMock(ok(COMPETITIVE));
    await getCompetitiveTierIconByTier(24);

    expect(mockRedisSet).toHaveBeenCalledTimes(1);
    expect(mockRedisSet.mock.calls[0]![0]).toBe("valorant:competitive");
  });
});
