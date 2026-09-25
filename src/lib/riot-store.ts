/**
 * Riot Store API Client
 *
 * Handles communication with the authenticated Riot Store endpoints.
 * Requires valid access token and entitlements token.
 */

import { RiotStorefront, RiotWallet } from "@/types/riot";
import { createLogger } from "./logger";
import { parseWithLog } from "@/lib/schemas/parse";
import { RiotStorefrontSchema, RiotWalletSchema } from "@/lib/schemas/storefront";

const log = createLogger("riot-store");

/** Minimum token set needed for store API requests */
export interface StoreTokens {
  accessToken: string;
  entitlementsToken: string;
  puuid: string;
  region: string;
}

/**
 * Thrown when Riot answers a store request with a status the caller has to see.
 *
 * Carries the status because a 401 is a different outcome from an upstream
 * failure: the tokens are dead and only a new login fixes it. A Server Component
 * cannot recover that from the message — the framework replaces it with a digest
 * before the error reaches the client.
 */
export class RiotStoreHttpError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(`Request failed with status ${status}: ${body}`);
    this.name = "RiotStoreHttpError";
    this.status = status;
  }
}

/** The failed response's body, or a placeholder when it cannot be read. */
async function readErrorBody(response: Response): Promise<string> {
  return response.text().catch(() => "No error body");
}

/**
 * Base64-encoded client platform identifier required by Riot PD endpoints.
 * This is the standard PC/Windows platform descriptor.
 */
const CLIENT_PLATFORM = btoa(JSON.stringify({
  platformType: "PC",
  platformOS: "Windows",
  platformOSVersion: "10.0.19045.1.256.64bit",
  platformChipset: "Unknown",
}));

/** Cached client version fetched from valorant-api.com */
let clientVersionCache: string | null = null;
let clientVersionFetchedAt = 0;
/** TTL that applies to the value currently in the cache — depends on where it came from */
let clientVersionCacheTtl = 0;
const VERSION_CACHE_TTL = 60 * 60 * 1000; // 1 hour
/**
 * The hardcoded fallback is cached far more briefly than a real version: it is a guess,
 * not an answer. A one-second blip upstream must not pin it for the full hour, so it
 * expires after a minute and the next request tries valorant-api.com again. The minute
 * still stands between a prolonged outage and one external call per store request.
 */
const VERSION_FALLBACK_CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Fetches the current Valorant client version from valorant-api.com.
 * riotclient.riotgames.com is not used: it no longer resolves in DNS, and every
 * attempt only added retries and delay before falling back here anyway.
 */
async function getClientVersion(): Promise<string> {
  const now = Date.now();
  if (clientVersionCache && now - clientVersionFetchedAt < clientVersionCacheTtl) {
    return clientVersionCache;
  }

  try {
    const version = await tryFetchFromValorantAPI();
    if (version) {
      clientVersionCache = version;
      clientVersionFetchedAt = now;
      clientVersionCacheTtl = VERSION_CACHE_TTL;
      log.info("Updated Client Version (ValorantAPI): %s", version);
      return version;
    }
  } catch (error) {
    log.warn("Valorant-API version fetch failed:", error);
  }

  // Last resort: use hardcoded fallback version
  // This version should be updated periodically or the app will eventually fail
  const hardcodedFallback = "release-12.05-shipping-22-4360629";
  log.warn("All version sources failed, using hardcoded fallback: %s", hardcodedFallback);
  clientVersionCache = hardcodedFallback;
  clientVersionFetchedAt = now;
  clientVersionCacheTtl = VERSION_FALLBACK_CACHE_TTL;
  return hardcodedFallback;
}

/**
 * Try to fetch version from valorant-api.com (public API)
 */
async function tryFetchFromValorantAPI(): Promise<string | null> {
  const response = await fetch("https://valorant-api.com/v1/version", {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Valorant-API returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  // Valorant-API returns { status: 200, data: { riotClientVersion: "release-12.05-shipping-22-4360629", ... } }
  const version: string = data.data.riotClientVersion;

  if (!version) {
    throw new Error("Valorant-API response missing riotClientVersion field");
  }

  return version;
}

/**
 * Maps region code to the correct PD (Platform Domain) URL
 * Note: LATAM and BR often share the NA infrastructure for some services,
 * but for Store, they adhere to the specific shards.
 * However, commonly known shards are: na, eu, ap, kr.
 * LATAM/BR are part of the 'na' shard group for PD usually.
 */
function getPdUrl(region: string): string {
  // Normalize region
  const r = region.toLowerCase();

  switch (r) {
    case "na":
      return "https://pd.na.a.pvp.net";
    case "latam":
      return "https://pd.latam.a.pvp.net";
    case "br":
      return "https://pd.br.a.pvp.net";
    case "ap":
    case "as":
    case "ind":
    case "jp":
    case "oce":
      return "https://pd.ap.a.pvp.net";
    case "eu":
    case "ru":
    case "tr":
      return "https://pd.eu.a.pvp.net";
    case "kr":
      return "https://pd.kr.a.pvp.net";
    default:
      // Fallback to NA
      return "https://pd.na.a.pvp.net";
  }
}

/**
 * Common headers for Riot Store API requests
 */
async function getStoreHeaders(tokens: StoreTokens) {
  const clientVersion = await getClientVersion();
  log.debug(`Using Client Version: ${clientVersion}`);

  return {
    Authorization: `Bearer ${tokens.accessToken}`,
    "X-Riot-Entitlements-JWT": tokens.entitlementsToken,
    "X-Riot-ClientPlatform": CLIENT_PLATFORM,
    "X-Riot-ClientVersion": clientVersion,
  };
}

/**
 * Fetch the player's storefront (Daily Shop, Night Market, Bundles)
 * Endpoint: /store/v2/storefront/{puuid}
 */
// In-memory cache for the correct shard to avoid repeated discovery.
// Keyed by PUUID so different users on different shards don't collide.
const cachedShardByPuuid = new Map<string, string>();

/**
 * Helper to fetch data with automatic shard fallback.
 *
 * Tries a single shard first — the one cached for this PUUID, or the session
 * region on first use — and remembers it on success, so the common case is one
 * request. Only a 404/405 — the shard saying it does not know this player —
 * sends the other shards a parallel probe (skipping any that map to an
 * already-tried PD host); probes that errored at the network level get one
 * sequential retry with a longer timeout. Any other status is an error the
 * caller has to see.
 */
export async function fetchWithShardFallback(
  tokens: StoreTokens,
  endpointBuilder: (pdUrl: string) => string
): Promise<Response> {
  const regions = ["na", "eu", "ap", "kr"];
  const preferred = cachedShardByPuuid.get(tokens.puuid) ?? tokens.region;

  const baseHeaders = await getStoreHeaders(tokens);

  // Fast path: one request to the preferred shard
  try {
    const response = await fetchWithRetry(endpointBuilder(getPdUrl(preferred)), baseHeaders, 10_000, true);
    if (response.ok) {
      cachedShardByPuuid.set(tokens.puuid, preferred);
      return response;
    }
    if (![404, 405].includes(response.status)) {
      // Not a wrong-shard error — other shards won't help. A 403 belongs here:
      // Riot answers it while a region is under maintenance, and a shard that
      // does not host this player would answer 200 with an empty account
      // (no skins, no VP), which would read as "you own nothing".
      const errorBody = await readErrorBody(response);
      throw new RiotStoreHttpError(response.status, errorBody);
    }
    log.warn(`Shard ${preferred.toUpperCase()} failed with ${response.status}, trying other shards`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Request failed with status")) throw err;
    log.warn(`Network error on ${preferred.toUpperCase()}, trying other shards:`, err);
  }

  // Remaining shards, deduplicated by PD host (e.g. "am" and "na" share pd.na)
  const triedHosts = new Set([getPdUrl(preferred)]);
  const others = [tokens.region, ...regions].filter((region) => {
    const host = getPdUrl(region);
    if (triedHosts.has(host)) return false;
    triedHosts.add(host);
    return true;
  });

  const results = await Promise.allSettled(
    others.map(region => {
      log.info(`Parallel shard probe: ${region.toUpperCase()} for ${tokens.puuid.substring(0, 8)}`);
      return fetchWithRetry(endpointBuilder(getPdUrl(region)), baseHeaders, 10_000, true).then(r => ({ response: r, region }));
    })
  );

  // A probe answering something other than 404/405 is not "wrong shard" — it is
  // the same error the fast path refuses to fall through on. Remembered rather
  // than thrown here, because a later probe may still be the right shard.
  let probeError: RiotStoreHttpError | null = null;

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { response, region } = result.value;
    if (response.ok) {
      log.info(`Shard discovery success: ${region.toUpperCase()} for ${tokens.puuid.substring(0, 8)}`);
      cachedShardByPuuid.set(tokens.puuid, region);
      return response;
    }
    if (!probeError && ![404, 405].includes(response.status)) {
      const errorBody = await readErrorBody(response);
      probeError = new RiotStoreHttpError(response.status, errorBody);
    }
  }

  // Retry shards whose probe failed at the network level (timeouts), with a longer timeout
  let lastError: Error | null = null;
  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled") continue;
    const region = others[i]!;
    log.info(`Fetching store for PUUID: ${tokens.puuid.substring(0, 8)} on shard: ${region.toUpperCase()}`);

    try {
      const response = await fetchWithRetry(endpointBuilder(getPdUrl(region)), baseHeaders, 30_000, false);
      if (response.ok) {
        log.info(`Discovered correct shard: ${region.toUpperCase()}`);
        cachedShardByPuuid.set(tokens.puuid, region);
        return response;
      }
      const errorBody = await readErrorBody(response);
      lastError = new RiotStoreHttpError(response.status, errorBody);
    } catch (err) {
      // A timeout on a later shard must not bury a status an earlier one answered with
      if (!(lastError instanceof RiotStoreHttpError)) lastError = err as Error;
      log.warn(`Network error on ${region.toUpperCase()}:`, err);
    }
  }

  // A status Riot actually answered with beats whatever the retries last saw:
  // every shard answers 401 for dead tokens, and only that status tells the
  // caller to send the user to login instead of offering a retry.
  throw probeError || lastError || new Error("Failed to find correct shard for user data");
}

/**
 * Perform a fetch with retry logic and configurable timeout.
 */
async function fetchWithRetry(
  url: string,
  baseHeaders: Record<string, string>,
  timeoutMs: number,
  isProbe: boolean
): Promise<Response> {
  // Only the v3 storefront is POST; other v3 endpoints (e.g. playerloadout) are GET
  const isPost = url.includes("/store/v3/storefront/");
  const method = isPost ? "POST" : "GET";
  const body = isPost ? "{}" : undefined;
  const headers = isPost
    ? { ...baseHeaders, "Content-Type": "application/json" }
    : baseHeaders;

  const response = await fetch(url, {
    method,
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });

  // On probe success or non-error response, return immediately
  if (isProbe || response.ok || ![403, 404, 405].includes(response.status)) {
    return response;
  }

  // For 4xx errors during sequential fallback, consume the body before throwing
  const _bodyText = await response.text().catch(() => "");
  return response;
}

export async function getStorefront(tokens: StoreTokens): Promise<RiotStorefront | null> {
  const response = await fetchWithShardFallback(tokens, (pdUrl) =>
    `${pdUrl}/store/v3/storefront/${tokens.puuid}`
  );

  const data = await response.json();
  return parseWithLog(RiotStorefrontSchema, data, "RiotStorefront") as RiotStorefront | null;
}

/**
 * Fetches the player's wallet balance (VP, RP, KC)
 * Endpoint: /store/v1/wallet/{puuid}
 */
export async function getWallet(tokens: StoreTokens): Promise<RiotWallet | null> {
  const response = await fetchWithShardFallback(tokens, (pdUrl) => 
    `${pdUrl}/store/v1/wallet/${tokens.puuid}`
  );

  const data = await response.json();
  return parseWithLog(RiotWalletSchema, data, "RiotWallet") as RiotWallet | null;
}
