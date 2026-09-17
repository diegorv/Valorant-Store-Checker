/**
 * Wishlist Persistence Module
 *
 * Manages per-account wishlist storage using SQLite with cookie fallback migration.
 * Each account's wishlist is stored separately using PUUID-based cookie keys during
 * the transition window.
 *
 * Storage strategy:
 * - SQLite-first persistence (session-db.ts wishlists table)
 * - Cookie fallback for legacy migration (Phase B deferred)
 * - Per-account isolation (cookie key includes PUUID prefix)
 * - No item cap (SQLite has no practical per-user limit)
 */

import { cookies } from "next/headers";
import type { ResultSet } from "@libsql/client";
import type { WishlistData, WishlistItem, WishlistMatchResult } from "@/types/wishlist";
import { createLogger } from "@/lib/logger";
import { getCurrentSessionId } from "@/lib/session";
import { initSessionDb } from "@/lib/session-db";
const log = createLogger("wishlist");

const WISHLIST_COOKIE_PREFIX = "valorant_wishlist_";

// ---------------------------------------------------------------------------
// Atomic mutations
// ---------------------------------------------------------------------------
// Reading the list into JS, editing it and writing it back loses one of two
// overlapping requests (two hearts clicked in a row): both read the same list
// and the second write overwrites the first. Both mutations below are a single
// statement, so SQLite serialises them and neither result is discarded.
//
// An interactive `db.transaction("write")` is NOT used on purpose: session-db
// creates the client without a busy timeout, so two concurrent BEGINs fail with
// SQLITE_BUSY on the local file — that trades a silent loss for a 500.
// ---------------------------------------------------------------------------

/**
 * Prepend an item (most recent first) unless its skinUuid is already stored.
 * ?1 = puuid, ?2 = item JSON, ?3 = item skinUuid.
 */
const ADD_TO_WISHLIST_SQL = `
  INSERT INTO wishlists (puuid, skins) VALUES (?1, json_array(json(?2)))
  ON CONFLICT(puuid) DO UPDATE SET skins = CASE
    WHEN EXISTS (
      SELECT 1 FROM json_each(wishlists.skins)
      WHERE json_extract(value, '$.skinUuid') = ?3
    ) THEN wishlists.skins
    ELSE (
      SELECT json_group_array(json(entry)) FROM (
        SELECT ?2 AS entry
        UNION ALL
        SELECT value AS entry FROM json_each(wishlists.skins)
      )
    )
  END
  RETURNING skins
`.trim();

/**
 * Drop every entry matching a skinUuid, preserving the order of the rest.
 * ?1 = puuid, ?2 = skinUuid. Returns no row when the account has no wishlist.
 */
const REMOVE_FROM_WISHLIST_SQL = `
  UPDATE wishlists SET skins = (
    SELECT json_group_array(json(entry)) FROM (
      SELECT value AS entry FROM json_each(wishlists.skins)
      WHERE json_extract(value, '$.skinUuid') <> ?2
    )
  )
  WHERE puuid = ?1
  RETURNING skins
`.trim();

/**
 * Turn the `RETURNING skins` row of an atomic mutation into wishlist data.
 * An empty result set means the account has no stored wishlist.
 */
function toWishlistData(result: ResultSet): WishlistData {
  const skinsJson = result.rows[0]?.skins;
  const items: WishlistItem[] =
    typeof skinsJson === "string" ? JSON.parse(skinsJson) : [];
  return { items, count: items.length };
}

/**
 * Get the cookie name for a specific account's wishlist
 * Uses first 8 chars of PUUID to create unique key
 */
function getWishlistCookieName(puuid: string): string {
  const puuidPrefix = puuid.substring(0, 8);
  return `${WISHLIST_COOKIE_PREFIX}${puuidPrefix}`;
}

/**
 * Read wishlist items from storage (SQLite-first with cookie fallback)
 *
 * Reads, and on a SQLite miss also migrates: it seeds the missing row from the
 * legacy cookie and clears that cookie. The seed is deliberately a no-op when
 * the row already exists, so it cannot clobber a concurrent write.
 *
 * The item-level mutations belong to addToWishlist / removeFromWishlist.
 *
 * @param puuid Account PUUID
 * @returns Promise resolving to array of wishlist items (empty on any error)
 */
async function readWishlistItems(puuid: string): Promise<WishlistItem[]> {
  try {
    // 1. Require an authenticated session
    const sessionId = await getCurrentSessionId();
    if (!sessionId) {
      return [];
    }

    // 2. Read from SQLite first
    const db = await initSessionDb();
    const result = await db.execute({
      sql: "SELECT skins FROM wishlists WHERE puuid = ?",
      args: [puuid],
    });

    if (result.rows.length > 0) {
      const skinsJson = result.rows[0]!.skins as string;
      log.debug(`Wishlist read from SQLite for ${puuid}`);
      return JSON.parse(skinsJson);
    }

    // 3. SQLite miss - fall back to cookie
    log.debug(`SQLite miss, falling back to cookie for ${puuid}`);
    const cookieStore = await cookies();
    const cookieName = getWishlistCookieName(puuid);
    const cookieValue = cookieStore.get(cookieName)?.value;

    if (!cookieValue) {
      return [];
    }

    // 4. Cookie exists - seed SQLite with it.
    // DO NOTHING, not DO UPDATE: this is a one-off seed of a missing row, and
    // the row may have been created by an overlapping request between the
    // SELECT above and this write. Overwriting it here would discard that
    // request's item - the same lost update the mutations below avoid.
    const items: WishlistItem[] = JSON.parse(cookieValue);
    const skinsJson = JSON.stringify(items);

    await db.execute({
      sql: `INSERT INTO wishlists (puuid, skins) VALUES (?, ?)
            ON CONFLICT(puuid) DO NOTHING`,
      args: [puuid, skinsJson],
    });

    // 5. Delete legacy cookie ONLY after successful write
    cookieStore.delete(cookieName);

    return items;
  } catch (error) {
    log.error("Error reading wishlist items:", error);
    return [];
  }
}

/**
 * Get wishlist for the active account
 * Uses readWishlistItems() helper for SQLite-first, cookie fallback reading.
 * @param puuid Account PUUID
 * @returns Wishlist data with items and count
 */
export async function getWishlist(puuid: string): Promise<WishlistData> {
  try {
    const items = await readWishlistItems(puuid);
    return { items, count: items.length };
  } catch (error) {
    log.error("Error reading wishlist:", error);
    return { items: [], count: 0 };
  }
}

/**
 * Add item to wishlist (with deduplication)
 * Deduplication and the prepend happen inside a single SQLite statement, so an
 * overlapping request cannot overwrite this one.
 * @param puuid Account PUUID
 * @param item Wishlist item to add
 * @returns Updated wishlist data
 */
export async function addToWishlist(
  puuid: string,
  item: WishlistItem
): Promise<WishlistData> {
  // Require an authenticated session
  const sessionId = await getCurrentSessionId();
  if (!sessionId) {
    return { items: [], count: 0 };
  }

  // Seed SQLite from the legacy cookie if it has not been migrated yet.
  // The returned items are deliberately unused: the statement below computes
  // the new list inside SQLite, never from a stale in-memory snapshot.
  await readWishlistItems(puuid);

  const db = await initSessionDb();
  const result = await db.execute({
    sql: ADD_TO_WISHLIST_SQL,
    args: [puuid, JSON.stringify(item), item.skinUuid],
  });

  return toWishlistData(result);
}

/**
 * Remove item from wishlist
 * The filter runs inside a single SQLite statement, so an overlapping request
 * cannot overwrite this one.
 * @param puuid Account PUUID
 * @param skinUuid UUID of skin to remove
 * @returns Updated wishlist data
 */
export async function removeFromWishlist(
  puuid: string,
  skinUuid: string
): Promise<WishlistData> {
  // Require an authenticated session
  const sessionId = await getCurrentSessionId();
  if (!sessionId) {
    return { items: [], count: 0 };
  }

  // Seed SQLite from the legacy cookie if it has not been migrated yet.
  // The returned items are deliberately unused: the statement below computes
  // the new list inside SQLite, never from a stale in-memory snapshot.
  await readWishlistItems(puuid);

  const db = await initSessionDb();
  const result = await db.execute({
    sql: REMOVE_FROM_WISHLIST_SQL,
    args: [puuid, skinUuid],
  });

  return toWishlistData(result);
}

/**
 * Check if a specific skin is wishlisted
 * @param puuid Account PUUID
 * @param skinUuid Skin UUID to check
 * @returns True if wishlisted
 */
export async function isWishlisted(
  puuid: string,
  skinUuid: string
): Promise<boolean> {
  const wishlist = await getWishlist(puuid);
  return wishlist.items.some((item) => item.skinUuid === skinUuid);
}

/**
 * Check which wishlisted skins are currently in the daily store
 * @param puuid Account PUUID
 * @param storeItemUuids Array of skin UUIDs currently in the store
 * @returns Array of match results showing which wishlisted skins are in store
 */
export async function checkWishlistInStore(
  puuid: string,
  storeItemUuids: string[]
): Promise<WishlistMatchResult[]> {
  const wishlist = await getWishlist(puuid);

  // Normalize store UUIDs to lowercase for case-insensitive comparison
  const normalizedStoreUuids = storeItemUuids.map((uuid) => uuid.toLowerCase());

  return wishlist.items.map((item) => ({
    skinUuid: item.skinUuid,
    displayName: item.displayName,
    isInStore: normalizedStoreUuids.includes(item.skinUuid.toLowerCase()),
  }));
}
