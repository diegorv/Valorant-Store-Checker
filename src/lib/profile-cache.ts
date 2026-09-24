/**
 * Profile Data Cache
 *
 * Orchestrates fetching of all player profile data — loadout (card/title),
 * Henrik account level, and competitive rank — with multi-tier fallback:
 *
 *   Tier 1: Live API fetch (Riot loadout + Henrik, in parallel)
 *   Tier 2: Stale cache (returned when ALL APIs fail)
 *   Tier 3: Partial data (no cache available, some APIs failed)
 *
 * This satisfies INFR-02 (graceful partial data when Henrik is unavailable)
 * and provides fromCache/partial/cachedAt metadata for INFR-03 (last updated notice).
 *
 * Architecture note (Redis-backed cache):
 * This module uses Upstash Redis for serverless-cold-start persistence.
 * TTL is 6 hours — rank and level change rarely, and every miss costs a
 * HenrikDev API request.
 */

import { redis } from "@/lib/redis-client";
import { StoreTokens } from "./riot-store";
import { getPlayerLoadout } from "./riot-loadout";
import { getHenrikAccount, getHenrikMMR, getHenrikStoredMatches, type HenrikMMRData } from "./henrik-api";
import { toRecentMatches, aggregateMatchStats, type RecentMatch, type MatchStats } from "./match-stats";
import { compareSeasonShortDesc } from "./season";
import { getPlayerCardByUuid, getPlayerTitleByUuid, getCompetitiveTierIconByTier } from "./valorant-api";
import { createLogger } from "./logger";

const log = createLogger("profile-cache");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Full player profile data assembled from Riot loadout + Henrik APIs. */
export interface ProfileData {
  // From Riot loadout
  playerCardId?: string;
  playerTitleId?: string;
  accountLevel?: number;
  hideAccountLevel?: boolean;

  // Hydrated card data (from valorant-api.ts)
  playerCardSmallArt?: string;
  playerCardWideArt?: string;
  playerCardLargeArt?: string;
  playerTitleText?: string;         // null-safe: titleText can be null from API

  // From Henrik account
  henrikName?: string;
  henrikTag?: string;
  henrikAccountLevel?: number;
  competitiveTier?: number;
  competitiveTierName?: string;     // e.g. "Gold 1"
  competitiveTierIcon?: string;     // rank icon URL
  rankingInTier?: number;           // RR in current tier (0-100)
  mmrChangeToLastGame?: number;
  peakTier?: number;                // highest_rank.tier from Henrik v2 MMR
  peakTierName?: string;            // highest_rank.patched from Henrik v2 MMR (e.g. "Gold 3")
  peakSeason?: string;              // act the peak was reached in, Henrik short code (e.g. "e8a2")
  gamesNeededForRating?: number;    // placement games left before a rank is assigned
  leaderboardRank?: number;         // Immortal+ leaderboard position, when placed
  actHistory?: ActRecord[];         // competitive history per act, newest first
  recentMatches?: RecentMatch[];    // last competitive matches, newest first
  matchStats?: MatchStats;          // aggregated over recentMatches

  // Metadata
  fromCache: boolean;
  partial: boolean;
  cachedAt?: number;                // timestamp for "last updated" display (INFR-03)
  nextUpdateAt?: number;            // when the cache expires and data will be re-fetched
  henrikFailed: boolean;            // true when Henrik API (account or MMR) fails
}

/** One act of competitive history, as shown on the profile page. */
export interface ActRecord {
  season: string;        // Henrik short code, e.g. "e8a2" or "v25a1"
  wins: number;
  games: number;
  endTier?: number;
  endTierName?: string;  // rank at the end of the act, e.g. "Gold 3"
  endRR?: number;
}

/** Acts with no games are noise; newest act first. */
function toActHistory(seasonal: HenrikMMRData["seasonal"]): ActRecord[] | undefined {
  if (!seasonal) return undefined;
  return seasonal
    .filter((act) => act.games > 0)
    .map((act) => ({
      season: act.season.short,
      wins: act.wins,
      games: act.games,
      endTier: act.end_tier?.id,
      endTierName: act.end_tier?.name,
      endRR: act.end_rr ?? undefined,
    }))
    .sort((a, b) => compareSeasonShortDesc(a.season, b.season));
}

/** Error class only: an @upstash/redis message embeds the command, and so the key. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

interface ProfileCacheEntry {
  data: ProfileData;
  cachedAt: number;
  /** Shape of `data`; entries written by an older build are treated as a miss */
  version?: number;
}

const PROFILE_KEY_PREFIX = "profile:";
const PROFILE_CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

/**
 * Bump whenever ProfileData gains fields the UI needs. Cached entries live for
 * 6 hours across deploys, so without this a new field stays invisible until
 * every user's entry has expired.
 *   1: original shape
 *   2: peakSeason, gamesNeededForRating, leaderboardRank, actHistory
 *   3: recentMatches, matchStats
 *   4: stored-match schema accepts damage.made (v3 entries may hold an empty list)
 */
export const PROFILE_CACHE_VERSION = 4;

/** How many competitive matches to keep on the profile (and aggregate over) */
const RECENT_MATCHES_LIMIT = 10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch complete profile data for the authenticated player.
 *
 * Fetches Riot loadout + Henrik account + Henrik MMR in parallel using
 * Promise.allSettled so that individual failures don't abort the others.
 *
 * If loadout succeeds, card and title UUIDs are hydrated to display names
 * and image URLs via valorant-api.ts.
 *
 * Fallback behavior:
 * - Cache hit (< 6 h old) → return with fromCache: true (INFR-03)
 * - Any real data obtained → cache and return (partial: false)
 * - All APIs failed + stale cache → return stale with fromCache: true
 * - All APIs failed + no cache → return partial profile (partial: true)
 */
export async function getProfileData(tokens: StoreTokens, region: string): Promise<ProfileData> {
  const key = `${PROFILE_KEY_PREFIX}${tokens.puuid}`;

  // Tier 0: Fresh cache hit — serve without hitting any APIs (INFR-03)
  let cached: string | null = null;
  if (redis) {
    try {
      cached = await redis.get<string>(key);
    } catch (error) {
      // Redis error (timeout, connection failure) — treat as cache miss.
      // Class name only: @upstash/redis puts the failing command in the error
      // message, and the command carries the full PUUID as part of the key.
      log.warn(`Profile cache read failed (${errorName(error)}), treating as a miss for PUUID:`, tokens.puuid.substring(0, 8));
    }
  }
  if (cached) {
    try {
      const entry: ProfileCacheEntry = JSON.parse(cached) as ProfileCacheEntry;
      const age = Date.now() - entry.cachedAt;
      if (entry.version !== PROFILE_CACHE_VERSION) {
        // Older build's shape: refetch now. Kept in `cached` for the Tier 2 fallback.
        log.info("Profile cache entry is from an older version, refetching for PUUID:", tokens.puuid.substring(0, 8));
      } else if (age < PROFILE_CACHE_TTL_SECONDS * 1000) {
        log.info("Profile served from cache for PUUID:", tokens.puuid.substring(0, 8));
        return {
          ...entry.data,
          fromCache: true,
          cachedAt: entry.cachedAt,
          nextUpdateAt: entry.cachedAt + PROFILE_CACHE_TTL_SECONDS * 1000,
        };
      }
    } catch {
      // Malformed cache entry, treat as miss
      if (redis) {
        try {
          await redis.del(key);
        } catch (error) {
          // The entry is already being treated as a miss; a failed cleanup
          // must not fail the request on top of that.
          log.warn(`Malformed cache entry cleanup failed (${errorName(error)}) for PUUID:`, tokens.puuid.substring(0, 8));
        }
      }
    }
  }

  // Tier 1: Fetch all sources in parallel; individual failures are tolerated
  const [loadoutResult, accountResult, mmrResult, matchesResult] = await Promise.allSettled([
    getPlayerLoadout(tokens),
    getHenrikAccount(tokens.puuid, region),
    getHenrikMMR(tokens.puuid, region),
    getHenrikStoredMatches(tokens.puuid, region, RECENT_MATCHES_LIMIT),
  ]);

  const loadout = loadoutResult.status === "fulfilled" ? loadoutResult.value : null;
  const account = accountResult.status === "fulfilled" ? accountResult.value : null;
  const mmr = mmrResult.status === "fulfilled" ? mmrResult.value : null;
  // Matches are a bonus: their failure never marks Henrik as failed
  const storedMatches = matchesResult.status === "fulfilled" ? matchesResult.value : null;
  if (matchesResult.status === "rejected") {
    log.warn("Henrik stored-matches fetch failed:", matchesResult.reason);
  }
  const recentMatches = storedMatches ? toRecentMatches(storedMatches).slice(0, RECENT_MATCHES_LIMIT) : undefined;

  if (loadoutResult.status === "rejected") {
    log.warn("Riot loadout fetch failed:", loadoutResult.reason);
  }
  if (accountResult.status === "rejected") {
    log.warn("Henrik account fetch failed:", accountResult.reason);
  }
  if (mmrResult.status === "rejected") {
    log.warn("Henrik MMR fetch failed:", mmrResult.reason);
  }

  // Detect Henrik API failure (account or MMR)
  const henrikFailed =
    accountResult.status === "rejected" ||
    mmrResult.status === "rejected" ||
    (accountResult.status === "fulfilled" && !accountResult.value && mmrResult.status === "fulfilled" && !mmrResult.value);

  // If loadout succeeded, hydrate card, title, and tier icon in parallel
  let cardData = null;
  let titleData = null;
  let tierIcon: string | null = null;
  if (loadout) {
    [cardData, titleData, tierIcon] = await Promise.all([
      getPlayerCardByUuid(loadout.Identity.PlayerCardID),
      getPlayerTitleByUuid(loadout.Identity.PlayerTitleID),
      mmr?.current?.tier?.id !== undefined
        ? getCompetitiveTierIconByTier(mmr.current.tier.id)
        : Promise.resolve(null),
    ]);
  }

  // Assemble ProfileData from whatever succeeded
  const profile: ProfileData = {
    // Loadout data
    playerCardId: loadout?.Identity.PlayerCardID,
    playerTitleId: loadout?.Identity.PlayerTitleID,
    accountLevel: loadout?.Identity.AccountLevel,
    hideAccountLevel: loadout?.Identity.HideAccountLevel,

    // Hydrated display data
    playerCardSmallArt: cardData?.smallArt,
    playerCardWideArt: cardData?.wideArt,
    playerCardLargeArt: cardData?.largeArt,
    playerTitleText: titleData?.titleText ?? undefined,

    // Henrik data
    henrikName: account?.name,
    henrikTag: account?.tag,
    henrikAccountLevel: account?.account_level,
    competitiveTier: mmr?.current?.tier?.id,
    competitiveTierName: mmr?.current?.tier?.name,
    competitiveTierIcon: undefined,          // hydrated below after assembly
    rankingInTier: mmr?.current?.rr,
    mmrChangeToLastGame: mmr?.current?.last_change,
    peakTier: mmr?.peak?.tier?.id,
    peakTierName: mmr?.peak?.tier?.name,
    peakSeason: mmr?.peak?.season?.short,
    gamesNeededForRating: mmr?.current?.games_needed_for_rating,
    leaderboardRank: mmr?.current?.leaderboard_placement?.rank ?? undefined,
    actHistory: toActHistory(mmr?.seasonal),
    recentMatches,
    matchStats: recentMatches ? aggregateMatchStats(recentMatches) ?? undefined : undefined,

    // Metadata — partial if we got nothing useful from either primary sources
    fromCache: false,
    partial: !loadout && !account,
    cachedAt: Date.now(),
    henrikFailed,
  };

  // Apply tier icon if we fetched it in parallel above
  if (tierIcon) profile.competitiveTierIcon = tierIcon;

  // Tier 1 success: at least some real data was obtained
  if (!profile.partial) {
    profile.nextUpdateAt = profile.cachedAt! + PROFILE_CACHE_TTL_SECONDS * 1000;
    const entry: ProfileCacheEntry = { data: profile, cachedAt: profile.cachedAt!, version: PROFILE_CACHE_VERSION };
    if (redis) {
      try {
        await redis.set(key, JSON.stringify(entry), { ex: PROFILE_CACHE_TTL_SECONDS });
      } catch (error) {
        // The data is already fetched — a cache write failure costs the next
        // request a miss, it must never fail this one.
        log.warn(`Profile cache write failed (${errorName(error)}) for PUUID:`, tokens.puuid.substring(0, 8));
      }
    }
    log.info("Profile fetched successfully for PUUID:", tokens.puuid.substring(0, 8));
    return profile;
  }

  // Tier 2: Total failure — try stale cache
  if (cached) {
    try {
      const entry: ProfileCacheEntry = JSON.parse(cached) as ProfileCacheEntry;
      log.warn("All APIs failed, returning stale cached profile for PUUID:", tokens.puuid.substring(0, 8));
      return { ...entry.data, fromCache: true };
    } catch {
      // Malformed stale cache, fall through
    }
  }

  // Tier 3: No stale cache available — return partial profile as-is
  log.warn("All APIs failed and no cache available, returning partial profile for PUUID:", tokens.puuid.substring(0, 8));
  return profile;
}

/**
 * Clear the profile cache.
 * If puuid is provided, removes only that player's entry.
 * If no puuid is provided, clears all cached profiles.
 */
export async function clearProfileCache(puuid?: string): Promise<void> {
  if (!redis) return;
  if (puuid) {
    const key = `${PROFILE_KEY_PREFIX}${puuid}`;
    await redis.del(key);
  } else {
    // Use SCAN to find and delete all profile keys (production-safe, not O(N) like KEYS)
    let cursor = "0";

    do {
      const [nextCursor, keys] = await redis.scan(cursor, {
        match: `${PROFILE_KEY_PREFIX}*`,
        count: 100,
      });
      cursor = nextCursor;

      // Delete all found keys
      for (const key of keys) {
        await redis.del(key);
      }
    } while (cursor !== "0");
  }
}
