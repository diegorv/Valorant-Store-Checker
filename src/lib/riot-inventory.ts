/**
 * Riot Inventory API Client
 *
 * Handles fetching player's owned weapon skins from Riot PD entitlements API.
 * Hydrates entitlements with asset data from Valorant-API.
 */

import { StoreTokens, fetchWithShardFallback } from "@/lib/riot-store";
import { getWeaponSkins, getWeaponSkinsByLevelUuids, getContentTiers, getSkinWeaponIndex } from "@/lib/valorant-api";
import type { ValorantWeaponSkin, ValorantContentTier } from "@/types/riot";
import { InventoryData, CollectionSkin, EditionCategory } from "@/types/inventory";
import { TIER_COLORS, DEFAULT_TIER_COLOR } from "@/types/store";
import { ITEM_TYPE_WEAPON_SKIN } from "@/lib/constants";
import { createLogger } from "./logger";
import { getBlurDataURL } from "@/lib/blur-utils";

const log = createLogger("riot-inventory");

/**
 * In-memory cache for inventory data
 * Keyed by PUUID, expires after 5 minutes
 */
interface CacheEntry {
  data: InventoryData;
  fetchedAt: number;
}

const inventoryCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// The TTL above is only checked when the same PUUID is read again, so an entry
// for a player who never comes back is never freed. Cap the map like
// store-cache.ts caps its Redis sorted set.
const MAX_CACHE_ENTRIES = 50;

/**
 * Stores an inventory in the module cache, evicting the oldest insertion first
 * once the cap is reached. Map iterates in insertion order and re-setting an
 * existing key keeps its position, so the first key is the oldest insertion.
 */
function cacheInventory(puuid: string, data: InventoryData, fetchedAt: number): void {
  if (!inventoryCache.has(puuid) && inventoryCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = inventoryCache.keys().next().value;
    if (oldest !== undefined) inventoryCache.delete(oldest);
  }

  inventoryCache.set(puuid, { data, fetchedAt });
}

/**
 * Weapon name for a skin valorant-api's weapon index does not list — a brand
 * new release, or the fallback entry below. The collection groups it under
 * "Other" (see collection-sort.ts).
 */
const UNKNOWN_WEAPON = "Unknown";

/**
 * Clears the in-memory inventory cache for a specific user.
 * Call this to force a fresh fetch on the next request.
 */
export function clearInventoryCache(puuid: string): void {
  inventoryCache.delete(puuid);
}

/** Tier colour the UI uses for a content tier, matching the encyclopedia. */
function tierColorFor(tier: ValorantContentTier | null): string {
  if (!tier) return DEFAULT_TIER_COLOR;
  return TIER_COLORS[tier.displayName.replace(" Edition", "")] || `#${tier.highlightColor.slice(0, 6)}`;
}

/**
 * Builds the collection entry for a catalog skin. Used for owned skins
 * (from entitlements) and for the rest of the catalog alike, so both render
 * through the same card.
 */
function toCollectionSkin(
  skin: ValorantWeaponSkin,
  tierMap: Map<string, ValorantContentTier>,
  skinWeapons: Map<string, string>,
  owned: boolean,
): { entry: CollectionSkin; tier: ValorantContentTier | null } {
  const tier = skin.contentTierUuid
    ? tierMap.get(skin.contentTierUuid.toLowerCase()) ?? null
    : null;
  const tierColor = tierColorFor(tier);

  // Best video: the highest level that has one
  let streamedVideo: string | null = null;
  for (let i = (skin.levels?.length ?? 0) - 1; i >= 0; i--) {
    const level = skin.levels[i];
    if (level?.streamedVideo) {
      streamedVideo = level.streamedVideo;
      break;
    }
  }

  return {
    tier,
    entry: {
      uuid: skin.uuid,
      displayName: skin.displayName,
      owned,
      displayIcon: skin.levels?.[0]?.displayIcon || skin.displayIcon || "",
      streamedVideo,
      wallpaper: skin.wallpaper,
      blurDataURL: getBlurDataURL(skin.wallpaper),
      tierUuid: tier?.uuid || null,
      tierName: tier?.displayName || null,
      tierColor,
      chromaCount: skin.chromas.length,
      levelCount: skin.levels.length,
      assetPath: skin.assetPath,
      weaponName: skinWeapons.get(skin.uuid.toLowerCase()) ?? UNKNOWN_WEAPON,
    },
  };
}

/** Weapon first, then skin name — the order both lists are served in. */
function byWeaponThenName(a: CollectionSkin, b: CollectionSkin): number {
  if (a.weaponName !== b.weaponName) return a.weaponName.localeCompare(b.weaponName);
  return a.displayName.localeCompare(b.displayName);
}

/**
 * Fetches player's owned weapon skins from Riot PD entitlements API,
 * hydrates them with asset data from Valorant-API, and pairs them with the
 * rest of the catalog (`unownedSkins`) so the collection view can tell the
 * two apart. Skins without a content tier (weapon defaults, "Random
 * Favorite") are not something you can own, so they are left out of the
 * catalog side.
 */
export async function getOwnedSkins(tokens: StoreTokens): Promise<InventoryData> {
  const now = Date.now();

  // Check cache first
  const cached = inventoryCache.get(tokens.puuid);
  if (cached && now - cached.fetchedAt < CACHE_TTL) {
    log.debug(`Serving cached inventory for PUUID: ${tokens.puuid.substring(0, 8)}`);
    return cached.data;
  }

  log.info(`Fetching entitlements for PUUID: ${tokens.puuid.substring(0, 8)}`);

  // Fetch entitlements from Riot PD API
  const response = await fetchWithShardFallback(tokens, (pdUrl) =>
    `${pdUrl}/store/v1/entitlements/${tokens.puuid}/${ITEM_TYPE_WEAPON_SKIN}`
  );

  const data = await response.json();
  log.debug("Entitlements response:", JSON.stringify(data).substring(0, 200));

  // Parse entitlements - handle both response formats
  let entitlements: Array<{ ItemID: string }> = [];

  if (data.EntitlementsByTypes) {
    // Format 1: { EntitlementsByTypes: [{ ItemTypeID, Entitlements: [...] }] }
    const weaponSkinEntitlements = data.EntitlementsByTypes.find(
      (e: { ItemTypeID: string }) => e.ItemTypeID === ITEM_TYPE_WEAPON_SKIN
    );
    entitlements = weaponSkinEntitlements?.Entitlements || [];
  } else if (data.Entitlements) {
    // Format 2: { Entitlements: [{ TypeID, ItemID }] }
    entitlements = data.Entitlements;
  }

  log.info(`Found ${entitlements.length} owned skins`);

  // Extract skin UUIDs
  const skinUuids = entitlements.map((e) => e.ItemID);

  // Batch hydrate with Valorant-API data
  // Note: Riot entitlements API returns skin LEVEL UUIDs, not parent skin UUIDs
  log.debug(`Hydrating ${skinUuids.length} skin level entitlements from Valorant-API`);
  const [skinsMap, allTiers, catalog, skinWeapons] = await Promise.all([
    skinUuids.length > 0 ? getWeaponSkinsByLevelUuids(skinUuids) : Promise.resolve(new Map<string, ValorantWeaponSkin>()),
    // Pre-fetch ALL content tiers once — eliminates N serial getContentTierByUuid() calls
    getContentTiers(),
    getWeaponSkins(),
    // The weapon each skin belongs to — the skins endpoint doesn't say
    getSkinWeaponIndex(),
  ]);

  log.info(`Matched ${skinsMap.size} entitlements to skins from Valorant-API`);

  // Build owned entries (deduplicate since multiple levels map to same skin)
  const ownedSkins: CollectionSkin[] = [];
  const weaponNamesSet = new Set<string>();
  const editionMap = new Map<string, string>(); // tierName → tierColor
  const seenSkinUuids = new Set<string>();
  const tierMap = new Map(allTiers.map((t) => [t.uuid.toLowerCase(), t]));

  for (const uuid of skinUuids) {
    const skin = skinsMap.get(uuid.toLowerCase());

    // Skip if we already added this parent skin (dedup across level entitlements)
    if (skin && seenSkinUuids.has(skin.uuid.toLowerCase())) {
      continue;
    }

    if (!skin) {
      log.warn(`Skin not found in Valorant-API: ${uuid}`);

      // Don't drop unknown skins — create a fallback entry so the user
      // can still see them in the collection (e.g. brand-new releases
      // not yet indexed by valorant-api.com).
      if (!seenSkinUuids.has(uuid.toLowerCase())) {
        seenSkinUuids.add(uuid.toLowerCase());
        weaponNamesSet.add(UNKNOWN_WEAPON);

        ownedSkins.push({
          uuid,
          displayName: "New Skin",
          owned: true,
          displayIcon: "",
          streamedVideo: null,
          wallpaper: null,
          blurDataURL: getBlurDataURL(null),
          tierUuid: null,
          tierName: null,
          tierColor: DEFAULT_TIER_COLOR,
          chromaCount: 0,
          levelCount: 1,
          assetPath: "",
          weaponName: UNKNOWN_WEAPON,
        });
      }
      continue;
    }

    // Mark this parent skin as seen
    seenSkinUuids.add(skin.uuid.toLowerCase());

    const { entry, tier } = toCollectionSkin(skin, tierMap, skinWeapons, true);
    weaponNamesSet.add(entry.weaponName);
    if (tier?.displayName) editionMap.set(tier.displayName, entry.tierColor);
    ownedSkins.push(entry);
  }

  // The rest of the catalog: everything ownable that is not in the entitlements
  const unownedSkins: CollectionSkin[] = [];
  for (const skin of catalog) {
    if (!skin.contentTierUuid) continue; // weapon defaults, "Random Favorite Skin"
    if (seenSkinUuids.has(skin.uuid.toLowerCase())) continue;

    const { entry, tier } = toCollectionSkin(skin, tierMap, skinWeapons, false);
    weaponNamesSet.add(entry.weaponName);
    if (tier?.displayName) editionMap.set(tier.displayName, entry.tierColor);
    unownedSkins.push(entry);
  }

  ownedSkins.sort(byWeaponThenName);
  unownedSkins.sort(byWeaponThenName);

  // Sort weapon categories alphabetically
  const weaponCategories = Array.from(weaponNamesSet).sort();

  // Build edition categories ordered by rarity hierarchy
  const EDITION_ORDER = ["Select Edition", "Deluxe Edition", "Premium Edition", "Exclusive Edition", "Ultra Edition"];
  const editionCategories: EditionCategory[] = EDITION_ORDER
    .filter((name) => editionMap.has(name))
    .map((name) => ({ name, color: editionMap.get(name)! }));
  // Append any editions not in the predefined order
  for (const [name, color] of editionMap) {
    if (!EDITION_ORDER.includes(name)) {
      editionCategories.push({ name, color });
    }
  }

  const inventoryData: InventoryData = {
    skins: ownedSkins,
    totalCount: ownedSkins.length,
    unownedSkins,
    catalogCount: ownedSkins.length + unownedSkins.length,
    weaponCategories,
    editionCategories,
  };

  // Cache the result
  cacheInventory(tokens.puuid, inventoryData, now);
  
  // Persist to central cache for API fallback
  const { setCachedInventory } = await import("./inventory-cache");
  setCachedInventory(tokens.puuid, inventoryData);

  log.info(`Successfully hydrated ${ownedSkins.length} owned + ${unownedSkins.length} unowned skins across ${weaponCategories.length} weapon types`);

  return inventoryData;
}
