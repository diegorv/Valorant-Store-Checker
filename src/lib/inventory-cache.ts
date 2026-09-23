/**
 * Server-side Inventory Data Cache
 *
 * Caches player's weapon skins collection in memory, so the collection still
 * renders when a Riot request fails, as long as data was fetched once.
 */

import type { InventoryData } from "@/types/inventory";

interface CacheEntry {
  data: InventoryData;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();

// Inventory data is relatively static but we'll use a 24h expiration
// or until the next fresh fetch.
const CACHE_TTL = 24 * 60 * 60 * 1000;

// The TTL above is only checked when a key is read again, so an entry for a
// player who never comes back is never freed. Cap the map so a long-running
// instance can't grow unbounded.
const MAX_CACHE_ENTRIES = 50;

export function getCachedInventory(puuid: string): InventoryData | null {
  const entry = cache.get(puuid);
  if (!entry) return null;

  // Check if cache is too old (24h)
  if (Date.now() - entry.cachedAt > CACHE_TTL) {
    cache.delete(puuid);
    return null;
  }

  return entry.data;
}

export function setCachedInventory(puuid: string, data: InventoryData): void {
  // FIFO eviction: Map iterates in insertion order and re-setting an existing
  // key keeps its position, so the first key is the oldest insertion.
  if (!cache.has(puuid) && cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }

  cache.set(puuid, { data, cachedAt: Date.now() });
}

export function clearCachedInventory(puuid: string): void {
  cache.delete(puuid);
}
