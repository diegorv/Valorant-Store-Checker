/**
 * Inventory type definitions
 * Defines types for user's owned weapon skins collection
 */

/**
 * A weapon skin in the collection view, hydrated from Valorant-API.
 * `owned` says whether the player's Riot entitlements include it.
 * Similar to StoreItem but without pricing fields.
 */
export interface CollectionSkin {
  // Identity
  uuid: string; // Skin UUID
  displayName: string; // E.g., "Prime Vandal"
  owned: boolean; // Present in the player's entitlements

  // Visuals
  displayIcon: string; // Primary image URL
  streamedVideo: string | null; // Video preview URL (if available)
  wallpaper: string | null; // High-res background image
  blurDataURL: string;

  // Rarity
  tierUuid: string | null; // Content tier UUID
  tierName: string | null; // E.g., "Select", "Deluxe", "Premium"
  tierColor: string; // Hex color for rarity indicator

  // Metadata
  chromaCount: number; // Number of color variants
  levelCount: number; // Number of upgrade levels
  assetPath: string; // Asset reference path
  weaponName: string; // E.g., "Vandal", "Phantom", "Melee"
}

/** @deprecated Use CollectionSkin. Kept for callers that only read owned skins. */
export type OwnedSkin = CollectionSkin;

/**
 * Complete inventory response
 */
/**
 * Edition/tier category for filter UI
 */
export interface EditionCategory {
  name: string;   // E.g., "Select", "Deluxe", "Premium"
  color: string;  // Hex color for the tier pill indicator
}

/**
 * Complete inventory response
 */
export interface InventoryData {
  skins: CollectionSkin[];        // Owned skins only (owned: true)
  totalCount: number;             // Number of owned skins
  unownedSkins: CollectionSkin[]; // Rest of the catalog (owned: false); empty unless requested
  catalogCount: number;           // Owned + unowned, i.e. every skin that can be owned
  weaponCategories: string[];    // Unique weapon types for filtering (whole catalog)
  editionCategories: EditionCategory[]; // Unique tiers for filtering (whole catalog)
}
