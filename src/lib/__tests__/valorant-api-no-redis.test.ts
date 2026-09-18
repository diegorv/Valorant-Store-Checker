/**
 * valorant-api.ts with no Redis configured.
 *
 * `pnpm dev` and CI run without Upstash credentials, so `redis` is undefined and
 * every cache helper short-circuits. The other test files mock Redis as always
 * present, which left that path — the one most contributors actually run —
 * unexercised.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/redis-client", () => ({ redis: undefined }));

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
  getSkinLevelByUuid,
  getCacheStatus,
  _resetSkinsCache,
  _resetTiersCache,
} = await import("@/lib/valorant-api");

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
  chromas: [],
};

const SKIN_LEVEL = {
  uuid: "level-1",
  displayName: "Vandal Standard",
  levelItem: null,
  displayIcon: "level-icon.png",
  streamedVideo: null,
  assetPath: "Levels/Level-1",
};

function ok(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ status: 200, data }),
  } as unknown as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
  _resetSkinsCache();
  _resetTiersCache();
});

describe("without Redis", () => {
  it("still returns the fetched skins", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok([SKIN]));
    await expect(getWeaponSkins()).resolves.toEqual([SKIN]);
  });

  it("still returns a fetched skin level", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(SKIN_LEVEL));
    await expect(getSkinLevelByUuid("level-1")).resolves.toEqual(SKIN_LEVEL);
  });

  it("fetches once per process thanks to the in-memory skins cache", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok([SKIN]));

    await getWeaponSkins();
    await getWeaponSkins();

    // With no Redis the module-level cache is the only thing preventing a
    // second round trip for every caller.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rethrows a fetch failure rather than hanging on an absent cache", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(getWeaponSkins()).rejects.toThrow("network down");
  });

  it("returns a null skin level rather than throwing when the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(getSkinLevelByUuid("level-1")).resolves.toBeNull();
  });

  it("reports everything as uncached", async () => {
    const uncached = { cached: false, count: null, age: null, valid: false };
    await expect(getCacheStatus()).resolves.toEqual({
      weaponSkins: uncached,
      contentTiers: uncached,
      bundles: uncached,
    });
  });
});
