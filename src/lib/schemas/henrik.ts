import { z } from "zod";

export const HenrikAccountSchema = z
  .object({
    puuid: z.string(),
    region: z.string(),
    account_level: z.number(),
    name: z.string(),
    tag: z.string(),
    card: z.object({
      small: z.string(),
      large: z.string(),
      wide: z.string(),
      id: z.string(),
    }),
    last_update: z.string(),
    last_update_raw: z.number(),
  })
  .passthrough();

const HenrikMMRTierSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const HenrikSeasonRefSchema = z.object({
  id: z.string(),
  short: z.string(),
});

const HenrikMMRCurrentSchema = z.object({
  tier: HenrikMMRTierSchema,
  rr: z.number(),
  last_change: z.number(),
  elo: z.number(),
  games_needed_for_rating: z.number(),
  // Immortal+ only; null for everyone else
  leaderboard_placement: z.object({ rank: z.number() }).nullable().optional(),
});

const HenrikMMRPeakSchema = z.object({
  season: HenrikSeasonRefSchema.optional(),
  tier: HenrikMMRTierSchema.optional(),
  rr: z.number().optional(),
});

/**
 * One act of competitive history. Parsed entry by entry (see henrik-api.ts)
 * so one odd act cannot take the whole MMR response down with it.
 */
export const HenrikSeasonalSchema = z.object({
  season: HenrikSeasonRefSchema,
  wins: z.number(),
  games: z.number(),
  end_tier: HenrikMMRTierSchema.nullable().optional(),
  end_rr: z.number().nullable().optional(),
});

export const HenrikMMRSchema = z.object({
  current: HenrikMMRCurrentSchema.optional(),
  peak: HenrikMMRPeakSchema.optional(),
  seasonal: z.array(HenrikSeasonalSchema).optional(),
});
