/**
 * Henrik Dev API Client
 *
 * Fetches account level and competitive rank data from the Henrik Dev API
 * (https://henrikdev.xyz), which provides unofficial Valorant stats.
 *
 * All functions:
 * - Cache results in memory for 5 minutes to respect rate limits
 * - Return null on failure (never throw) to support INFR-02 graceful degradation
 * - Return stale cache entries when the live fetch fails
 */

import { env } from "./env";
import { createLogger } from "./logger";
import { parseWithLog } from "@/lib/schemas/parse";
import { HenrikAccountSchema, HenrikMMRSchema, HenrikSeasonalSchema, HenrikStoredMatchSchema, type HenrikStoredMatch } from "@/lib/schemas/henrik";
import { toHenrikRegion } from "@/lib/region-utils";

const log = createLogger("henrik-api");

const HENRIK_API_BASE = "https://api.henrikdev.xyz";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Account data returned by Henrik /v2/by-puuid/account */
export interface HenrikAccount {
  puuid: string;
  region: string;
  account_level: number;
  name: string;
  tag: string;
  card: {
    small: string;
    large: string;
    wide: string;
    id: string;
  };
  last_update: string;
  last_update_raw: number;
}

/** Tier object used in Henrik /v3/by-puuid/mmr response */
export interface HenrikMMRTier {
  id: number;
  name: string;
}

/** Current MMR data from Henrik /v3/by-puuid/mmr response */
export interface HenrikMMRCurrent {
  tier: HenrikMMRTier;
  rr: number;
  last_change: number;
  elo: number;
  games_needed_for_rating: number;
  /** Immortal+ only; null for everyone else */
  leaderboard_placement?: { rank: number } | null;
}

/** Peak rank data from Henrik /v3/by-puuid/mmr response */
export interface HenrikMMRPeak {
  season?: {
    id: string;
    short: string;
  };
  tier?: HenrikMMRTier;
  rr?: number;
}

/** One act of competitive history from Henrik /v3/by-puuid/mmr `seasonal[]` */
export interface HenrikSeasonal {
  season: { id: string; short: string };
  wins: number;
  games: number;
  end_tier?: HenrikMMRTier | null;
  end_rr?: number | null;
}

/** Full MMR response data from Henrik /v3/by-puuid/mmr */
export interface HenrikMMRData {
  current?: HenrikMMRCurrent;
  peak?: HenrikMMRPeak;
  seasonal?: HenrikSeasonal[];
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const accountCache = new Map<string, CacheEntry<HenrikAccount>>();
const mmrCache = new Map<string, CacheEntry<HenrikMMRData>>();
const matchesCache = new Map<string, CacheEntry<HenrikStoredMatch[]>>();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build Henrik API request headers, including the API key when configured. */
function henrikHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (env.HENRIK_API_KEY) {
    headers["Authorization"] = env.HENRIK_API_KEY;
  } else {
    log.warn("HENRIK_API_KEY not set — Henrik API calls may fail without a key");
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch Valorant account data by PUUID from the Henrik API.
 * Results are cached for 5 minutes. On failure, stale cache is returned.
 * Never throws — returns null if both live fetch and stale cache are unavailable.
 */
export async function getHenrikAccount(puuid: string, region: string): Promise<HenrikAccount | null> {
  const cached = accountCache.get(puuid);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    log.info("Returning cached Henrik account for PUUID:", puuid.substring(0, 8));
    return cached.data;
  }

  const henrikRegion = toHenrikRegion(region);

  try {
    const response = await fetch(
      `${HENRIK_API_BASE}/valorant/v2/by-puuid/account/${henrikRegion}/${puuid}`,
      {
        cache: "no-store",
        headers: henrikHeaders(),
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!response.ok) {
      log.warn("Henrik account fetch returned HTTP", response.status, "for PUUID:", puuid.substring(0, 8));
      return cached?.data ?? null;
    }

    const json = await response.json();
    const account = parseWithLog(HenrikAccountSchema, json.data, "HenrikAccount");
    if (!account) { return cached?.data ?? null; }
    accountCache.set(puuid, { data: account, fetchedAt: Date.now() });
    log.info("Henrik account fetched successfully for PUUID:", puuid.substring(0, 8));
    return account;
  } catch (error) {
    log.error("Henrik account fetch network error for PUUID:", puuid.substring(0, 8), error);
    return cached?.data ?? null;
  }
}

/**
 * Fetch current competitive MMR data by PUUID from the Henrik API.
 * Results are cached for 5 minutes. On failure, stale cache is returned.
 * Never throws — returns null if both live fetch and stale cache are unavailable.
 */
export async function getHenrikMMR(puuid: string, region: string): Promise<HenrikMMRData | null> {
  const cached = mmrCache.get(puuid);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    log.info("Returning cached Henrik MMR for PUUID:", puuid.substring(0, 8));
    return cached.data;
  }

  const henrikRegion = toHenrikRegion(region);

  try {
    // v3 MMR endpoint — v2 was deprecated. v3 uses platform ("pc") in the URL.
    const response = await fetch(
      `${HENRIK_API_BASE}/valorant/v3/by-puuid/mmr/${henrikRegion}/pc/${puuid}`,
      {
        cache: "no-store",
        headers: henrikHeaders(),
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!response.ok) {
      log.warn("Henrik MMR fetch returned HTTP", response.status, "for PUUID:", puuid.substring(0, 8));
      return cached?.data ?? null;
    }

    const json = await response.json();
    // Acts are validated one by one: an act with an unexpected shape is dropped
    // with a log line instead of failing the whole response (and the rank with it).
    const seasonal = Array.isArray(json.data.seasonal)
      ? json.data.seasonal.flatMap((act: unknown) => {
          const parsed = HenrikSeasonalSchema.safeParse(act);
          if (!parsed.success) log.warn("Dropping malformed seasonal entry:", parsed.error.issues[0]?.message);
          return parsed.success ? [parsed.data] : [];
        })
      : undefined;
    const rawMmr = { current: json.data.current, peak: json.data.peak, seasonal };
    const mmrData = parseWithLog(HenrikMMRSchema, rawMmr, "HenrikMMR");
    if (!mmrData) { return cached?.data ?? null; }
    mmrCache.set(puuid, { data: mmrData, fetchedAt: Date.now() });
    log.info("Henrik MMR fetched successfully for PUUID:", puuid.substring(0, 8));
    return mmrData;
  } catch (error) {
    log.error("Henrik MMR fetch network error for PUUID:", puuid.substring(0, 8), error);
    return cached?.data ?? null;
  }
}

/**
 * Fetch the player's most recent competitive matches from Henrik's stored
 * match history (lightweight per-player summaries, not full match details).
 * Results are cached for 5 minutes. On failure, stale cache is returned.
 * Never throws — returns null if both live fetch and stale cache are unavailable.
 * Matches are validated one by one: an entry with an unexpected shape is
 * dropped with a log line instead of failing the whole list.
 */
export async function getHenrikStoredMatches(
  puuid: string,
  region: string,
  size = 20,
): Promise<HenrikStoredMatch[] | null> {
  // Keyed by size too: a caller asking for 20 must not get a cached list of 10
  const cacheKey = `${puuid}:${size}`;
  const cached = matchesCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    log.info("Returning cached Henrik matches for PUUID:", puuid.substring(0, 8));
    return cached.data;
  }

  const henrikRegion = toHenrikRegion(region);
  const params = new URLSearchParams({ mode: "competitive", size: String(size) });

  try {
    const response = await fetch(
      `${HENRIK_API_BASE}/valorant/v1/by-puuid/stored-matches/${henrikRegion}/${puuid}?${params}`,
      {
        cache: "no-store",
        headers: henrikHeaders(),
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!response.ok) {
      log.warn("Henrik stored-matches fetch returned HTTP", response.status, "for PUUID:", puuid.substring(0, 8));
      return cached?.data ?? null;
    }

    const json = await response.json();
    if (!Array.isArray(json.data)) {
      log.warn("Henrik stored-matches: unexpected payload shape for PUUID:", puuid.substring(0, 8));
      return cached?.data ?? null;
    }
    const matches: HenrikStoredMatch[] = json.data.flatMap((entry: unknown) => {
      const parsed = HenrikStoredMatchSchema.safeParse(entry);
      if (!parsed.success) log.warn("Dropping malformed stored match:", parsed.error.issues[0]?.path.join("."), parsed.error.issues[0]?.message);
      return parsed.success ? [parsed.data] : [];
    });
    matchesCache.set(cacheKey, { data: matches, fetchedAt: Date.now() });
    log.info(`Henrik stored-matches fetched: ${matches.length} of ${json.data.length} entries kept for PUUID:`, puuid.substring(0, 8));
    return matches;
  } catch (error) {
    log.error("Henrik stored-matches fetch network error for PUUID:", puuid.substring(0, 8), error);
    return cached?.data ?? null;
  }
}

/**
 * Clear the Henrik in-memory cache.
 * If puuid is provided, removes only that player's entries.
 * If no puuid is provided, clears all cached data.
 */
export function clearHenrikCache(puuid?: string): void {
  if (puuid) {
    accountCache.delete(puuid);
    mmrCache.delete(puuid);
    for (const key of matchesCache.keys()) {
      if (key.startsWith(`${puuid}:`)) matchesCache.delete(key);
    }
  } else {
    accountCache.clear();
    mmrCache.clear();
    matchesCache.clear();
  }
}
