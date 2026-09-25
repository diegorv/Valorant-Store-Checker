/**
 * Zod schemas for Valorant-API.com v1 responses.
 *
 * These schemas validate the raw JSON from Valorant-API's endpoints.
 * `.passthrough()` is NOT used by default since we enumerate all known fields.
 *
 * @see src/types/riot.ts for the equivalent TS interfaces (ValorantAPIResponse, ValorantWeaponSkin, etc.)
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Weapon Skin schemas
// ---------------------------------------------------------------------------

export const WeaponSkinLevelSchema = z.object({
  uuid: z.string(),
  displayName: z.string(),
  levelItem: z.string().nullable(),
  displayIcon: z.string().nullable(),
  streamedVideo: z.string().nullable(),
  assetPath: z.string(),
});

export const WeaponSkinChromaSchema = z.object({
  uuid: z.string(),
  displayName: z.string(),
  displayIcon: z.string().nullable(),
  fullRender: z.string(),
  swatch: z.string().nullable(),
  streamedVideo: z.string().nullable(),
  assetPath: z.string(),
});

export const ValorantWeaponSkinSchema = z.object({
  uuid: z.string(),
  displayName: z.string(),
  themeUuid: z.string(),
  contentTierUuid: z.string().nullable(),
  displayIcon: z.string().nullable(),
  wallpaper: z.string().nullable(),
  assetPath: z.string(),
  chromas: z.array(WeaponSkinChromaSchema),
  levels: z.array(WeaponSkinLevelSchema),
});

// ---------------------------------------------------------------------------
// Weapon schema (/v1/weapons)
// ---------------------------------------------------------------------------

/**
 * Only the two fields the skin → weapon index needs. The endpoint repeats the
 * whole skin payload under every weapon, which zod strips here.
 */
export const ValorantWeaponSchema = z.object({
  displayName: z.string(),
  skins: z.array(z.object({ uuid: z.string() })),
});

export type ValorantWeapon = z.infer<typeof ValorantWeaponSchema>;

// ---------------------------------------------------------------------------
// Content Tier schema
// ---------------------------------------------------------------------------

export const ValorantContentTierSchema = z.object({
  uuid: z.string(),
  displayName: z.string(),
  devName: z.string(),
  rank: z.number(),
  juiceValue: z.number(),
  juiceCost: z.number(),
  highlightColor: z.string(),
  displayIcon: z.string(),
  assetPath: z.string(),
});

// ---------------------------------------------------------------------------
// Bundle schema
// ---------------------------------------------------------------------------

export const ValorantBundleSchema = z.object({
  uuid: z.string(),
  displayName: z.string(),
  displayNameSubText: z.string().nullable(),
  description: z.string().nullable(),
  extraDescription: z.string().nullable(),
  promoDescription: z.string().nullable(),
  useAdditionalContext: z.boolean(),
  displayIcon: z.string(),
  displayIcon2: z.string(),
  verticalPromoImage: z.string().nullable(),
  assetPath: z.string(),
});

// ---------------------------------------------------------------------------
// Individual item schemas (used in bundle hydration)
// ---------------------------------------------------------------------------

export const ValorantSkinLevelSchema = WeaponSkinLevelSchema;

export const ValorantBuddyLevelSchema = z.object({
  uuid: z.string(),
  displayName: z.string(),
  displayIcon: z.string().nullable(),
  assetPath: z.string(),
});

export const ValorantSpraySchema = z.object({
  uuid: z.string(),
  displayName: z.string(),
  displayIcon: z.string().nullable(),
  fullIcon: z.string().nullish(),
  fullTransparentIcon: z.string().nullish(),
  assetPath: z.string(),
});

export const ValorantSprayLevelSchema = z.object({
  uuid: z.string(),
  sprayLevel: z.number(),
  displayName: z.string(),
  displayIcon: z.string().nullable(),
  assetPath: z.string(),
});

export const ValorantPlayerCardSchema = z.object({
  uuid: z.string(),
  displayName: z.string(),
  isHiddenIfNotOwned: z.boolean(),
  themeUuid: z.string().nullable(),
  displayIcon: z.string().nullable(),
  smallArt: z.string(),
  wideArt: z.string(),
  largeArt: z.string(),
  assetPath: z.string(),
});

export const ValorantPlayerTitleSchema = z.object({
  uuid: z.string(),
  displayName: z.string(),
  titleText: z.string().nullable(),
  isHiddenIfNotOwned: z.boolean(),
  assetPath: z.string(),
});

// ---------------------------------------------------------------------------
// Competitive tiers
// ---------------------------------------------------------------------------

export const CompetitiveTierSchema = z.object({
  tier: z.number(),
  largeIcon: z.string().nullable(),
});

export const CompetitiveSeasonSchema = z.object({
  tiers: z.array(CompetitiveTierSchema),
});
