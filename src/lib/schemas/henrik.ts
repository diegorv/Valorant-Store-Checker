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

/**
 * One entry of Henrik /v1/by-puuid/stored-matches. Only the fields the
 * profile uses are declared; the rest of the payload is dropped on parse,
 * which keeps the in-memory cache small. Parsed entry by entry (see
 * henrik-api.ts) so one odd match cannot drop the list.
 */
export const HenrikStoredMatchSchema = z.object({
  meta: z.object({
    id: z.string(),
    map: z.object({ id: z.string().nullable().optional(), name: z.string() }),
    mode: z.string().nullable().optional(),
    started_at: z.string(),
    season: HenrikSeasonRefSchema.nullable().optional(),
  }),
  stats: z.object({
    team: z.string(),
    character: z.object({ id: z.string().nullable().optional(), name: z.string() }),
    tier: z.number().nullable().optional(),
    score: z.number(),
    kills: z.number(),
    deaths: z.number(),
    assists: z.number(),
    shots: z.object({ head: z.number(), body: z.number(), leg: z.number() }),
    // Henrik spells damage dealt `made` on the stored-matches endpoint and
    // `dealt` on the match endpoints; accept either.
    damage: z.object({
      dealt: z.number().optional(),
      made: z.number().optional(),
      received: z.number().nullable().optional(),
    }),
  }),
  teams: z.object({ red: z.number().nullable(), blue: z.number().nullable() }),
});

export type HenrikStoredMatch = z.infer<typeof HenrikStoredMatchSchema>;

export const HenrikMMRSchema = z.object({
  current: HenrikMMRCurrentSchema.optional(),
  peak: HenrikMMRPeakSchema.optional(),
  seasonal: z.array(HenrikSeasonalSchema).optional(),
});
