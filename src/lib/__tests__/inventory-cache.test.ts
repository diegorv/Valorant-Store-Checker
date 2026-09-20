import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InventoryData } from "@/types/inventory";

// ---------------------------------------------------------------------------
// Mocks — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

const mockFetchWithShardFallback = vi.fn();

vi.mock("@/lib/riot-store", () => ({
  fetchWithShardFallback: (...args: unknown[]) => mockFetchWithShardFallback(...args),
}));

// getOwnedSkins always loads the catalog side (tiers + every skin) so the
// collection can show what is not owned; keep that off the network here.
vi.mock("@/lib/valorant-api", () => ({
  getWeaponSkins: vi.fn(async () => []),
  getContentTiers: vi.fn(async () => []),
  getWeaponSkinsByLevelUuids: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mirrors MAX_CACHE_ENTRIES in both cache modules.
const MAX_CACHE_ENTRIES = 50;

function makeInventory(totalCount = 0): InventoryData {
  return { skins: [], totalCount, unownedSkins: [], catalogCount: totalCount, weaponCategories: [], editionCategories: [] };
}

// Each test gets a fresh module instance so the module-level Map starts empty.
async function freshInventoryCache() {
  vi.resetModules();
  return await import("@/lib/inventory-cache");
}

async function freshRiotInventory() {
  vi.resetModules();
  return await import("@/lib/riot-inventory");
}

function tokensFor(puuid: string) {
  return {
    accessToken: "test-access-token",
    entitlementsToken: "test-entitlements-token",
    puuid,
    region: "na",
  };
}

describe("setCachedInventory eviction", () => {
  it("keeps at most MAX_CACHE_ENTRIES entries, evicting the oldest insertion", async () => {
    const { setCachedInventory, getCachedInventory } = await freshInventoryCache();

    for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
      setCachedInventory(`puuid-${i}`, makeInventory(i));
    }
    expect(getCachedInventory("puuid-0")).not.toBeNull();

    setCachedInventory("puuid-overflow", makeInventory(999));

    // First insertion evicted, everything else still cached
    expect(getCachedInventory("puuid-0")).toBeNull();
    expect(getCachedInventory("puuid-1")?.totalCount).toBe(1);
    expect(getCachedInventory("puuid-overflow")?.totalCount).toBe(999);
  });

  it("does not evict when overwriting an existing key at capacity", async () => {
    const { setCachedInventory, getCachedInventory } = await freshInventoryCache();

    for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
      setCachedInventory(`puuid-${i}`, makeInventory(i));
    }

    setCachedInventory("puuid-10", makeInventory(123));

    expect(getCachedInventory("puuid-0")?.totalCount).toBe(0);
    expect(getCachedInventory("puuid-10")?.totalCount).toBe(123);
  });
});

describe("getOwnedSkins cache eviction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchWithShardFallback.mockResolvedValue({
      json: async () => ({ Entitlements: [] }),
    });
  });

  it("keeps at most MAX_CACHE_ENTRIES entries, evicting the oldest insertion", async () => {
    const { getOwnedSkins } = await freshRiotInventory();

    for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
      await getOwnedSkins(tokensFor(`puuid-${i}`));
    }
    expect(mockFetchWithShardFallback).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES);

    // Still cached — no extra fetch
    await getOwnedSkins(tokensFor("puuid-0"));
    expect(mockFetchWithShardFallback).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES);

    // One entry past the cap evicts the oldest insertion (puuid-0)
    await getOwnedSkins(tokensFor("puuid-overflow"));
    expect(mockFetchWithShardFallback).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES + 1);

    await getOwnedSkins(tokensFor("puuid-0"));
    expect(mockFetchWithShardFallback).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES + 2);

    // The newest entry is still cached
    await getOwnedSkins(tokensFor("puuid-overflow"));
    expect(mockFetchWithShardFallback).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES + 2);
  });
});
