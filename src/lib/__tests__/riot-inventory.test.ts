/**
 * riot-inventory.ts — the weapon a collection entry is filed under.
 *
 * The weapon name used to be the last word of the skin's display name, which
 * turned every melee skin into its own weapon ("Karambit", "Axe", "Claw", …)
 * and filled the collection's weapon filter with a hundred inventions. It now
 * comes from valorant-api's skin → weapon index.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ValorantWeaponSkin } from "@/types/riot";

// ---------------------------------------------------------------------------
// Mocks — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

const mockFetchWithShardFallback = vi.fn();

vi.mock("@/lib/riot-store", () => ({
  fetchWithShardFallback: (...args: unknown[]) => mockFetchWithShardFallback(...args),
}));

const mockGetWeaponSkins = vi.fn(async (): Promise<ValorantWeaponSkin[]> => []);
const mockGetWeaponSkinsByLevelUuids = vi.fn(async () => new Map<string, ValorantWeaponSkin>());
const mockGetSkinWeaponIndex = vi.fn(async () => new Map<string, string>());

vi.mock("@/lib/valorant-api", () => ({
  getWeaponSkins: () => mockGetWeaponSkins(),
  getContentTiers: async () => [],
  getWeaponSkinsByLevelUuids: () => mockGetWeaponSkinsByLevelUuids(),
  getSkinWeaponIndex: () => mockGetSkinWeaponIndex(),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SELECT_TIER = "tier-select";

function catalogSkin(uuid: string, displayName: string): ValorantWeaponSkin {
  return {
    uuid,
    displayName,
    themeUuid: "theme-1",
    contentTierUuid: SELECT_TIER,
    displayIcon: `${uuid}.png`,
    wallpaper: null,
    assetPath: `Skins/${uuid}`,
    chromas: [],
    levels: [{ uuid: `${uuid}-level-1`, displayName, levelItem: null, displayIcon: null, streamedVideo: null, assetPath: `Levels/${uuid}` }],
  };
}

function tokensFor(puuid: string) {
  return {
    accessToken: "test-access-token",
    entitlementsToken: "test-entitlements-token",
    puuid,
    region: "na",
  };
}

/** A fresh module instance per test — getOwnedSkins memoizes per PUUID. */
async function freshRiotInventory() {
  vi.resetModules();
  return await import("@/lib/riot-inventory");
}

/** Owns `owned`, with `catalog` on the shelf and `weapons` as the index. */
function givenCollection(options: {
  owned?: ValorantWeaponSkin[];
  catalog?: ValorantWeaponSkin[];
  weapons?: Record<string, string>;
  unmatchedEntitlements?: string[];
}) {
  const owned = options.owned ?? [];
  const entitlements = [
    ...owned.map((skin) => ({ ItemID: skin.levels[0]!.uuid })),
    ...(options.unmatchedEntitlements ?? []).map((ItemID) => ({ ItemID })),
  ];

  mockFetchWithShardFallback.mockResolvedValue({ json: async () => ({ Entitlements: entitlements }) });
  // The real lookup keys its Map by the lowercased entitlement UUID
  mockGetWeaponSkinsByLevelUuids.mockResolvedValue(new Map(owned.map((skin) => [skin.levels[0]!.uuid.toLowerCase(), skin])));
  mockGetWeaponSkins.mockResolvedValue([...owned, ...(options.catalog ?? [])]);
  mockGetSkinWeaponIndex.mockResolvedValue(new Map(Object.entries(options.weapons ?? {})));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getOwnedSkins weapon names", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("files every melee skin under the single Melee weapon", async () => {
    givenCollection({
      owned: [catalogSkin("skin-karambit", "Reaver Karambit"), catalogSkin("skin-claw", "Oni Claw")],
      weapons: { "skin-karambit": "Melee", "skin-claw": "Melee" },
    });

    const { getOwnedSkins } = await freshRiotInventory();
    const inventory = await getOwnedSkins(tokensFor("puuid-melee"));

    expect(inventory.skins.map((s) => s.weaponName)).toEqual(["Melee", "Melee"]);
    expect(inventory.weaponCategories).toEqual(["Melee"]);
  });

  it("names a gun whose skin name does not end in the weapon name", async () => {
    givenCollection({
      owned: [catalogSkin("skin-random-favorite", "Random Favorite Skin")],
      weapons: { "skin-random-favorite": "Vandal" },
    });

    const { getOwnedSkins } = await freshRiotInventory();
    const inventory = await getOwnedSkins(tokensFor("puuid-random"));

    expect(inventory.skins[0]!.weaponName).toBe("Vandal");
  });

  it("matches the index case-insensitively, as Riot's UUID casing varies", async () => {
    givenCollection({
      owned: [catalogSkin("SKIN-PRIME", "Prime Vandal")],
      weapons: { "skin-prime": "Vandal" },
    });

    const { getOwnedSkins } = await freshRiotInventory();
    const inventory = await getOwnedSkins(tokensFor("puuid-case"));

    expect(inventory.skins[0]!.weaponName).toBe("Vandal");
  });

  it("names the unowned side of the catalog from the same index", async () => {
    givenCollection({
      catalog: [catalogSkin("skin-oni", "Oni Phantom"), catalogSkin("skin-sword", "Sky Reaper Sword")],
      weapons: { "skin-oni": "Phantom", "skin-sword": "Melee" },
    });

    const { getOwnedSkins } = await freshRiotInventory();
    const inventory = await getOwnedSkins(tokensFor("puuid-unowned"));

    expect(inventory.unownedSkins.map((s) => [s.displayName, s.weaponName])).toEqual([
      ["Sky Reaper Sword", "Melee"],
      ["Oni Phantom", "Phantom"],
    ]);
  });

  it("falls back to Unknown for a skin the weapon index does not list", async () => {
    givenCollection({
      owned: [catalogSkin("skin-released-today", "Brand New Vandal")],
      weapons: {},
    });

    const { getOwnedSkins } = await freshRiotInventory();
    const inventory = await getOwnedSkins(tokensFor("puuid-unindexed"));

    expect(inventory.skins[0]!.weaponName).toBe("Unknown");
    expect(inventory.weaponCategories).toEqual(["Unknown"]);
  });

  it("falls back to Unknown for an entitlement valorant-api has never heard of", async () => {
    givenCollection({
      owned: [catalogSkin("skin-prime", "Prime Vandal")],
      weapons: { "skin-prime": "Vandal" },
      unmatchedEntitlements: ["level-uuid-nobody-knows"],
    });

    const { getOwnedSkins } = await freshRiotInventory();
    const inventory = await getOwnedSkins(tokensFor("puuid-fallback"));

    const fallback = inventory.skins.find((s) => s.displayName === "New Skin");
    expect(fallback?.weaponName).toBe("Unknown");
    expect(inventory.weaponCategories).toEqual(["Unknown", "Vandal"]);
  });
});
