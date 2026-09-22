/**
 * Store history — server side
 *
 * One row per account and day in LibSQL (the same database that holds
 * sessions and wishlists), written when the store page renders. Replaces
 * the browser-only IndexedDB log, which was lost with the browser and only
 * covered the device it was written on.
 */

import { initSessionDb } from "./session-db";
import { createLogger } from "./logger";
import type { StoreItem } from "@/types/store";
import type { StoreRotation, HistoryStoreItem } from "@/types/history";

const log = createLogger("store-history-db");

/** Rotation day, UTC — the store rotates at 00:00 UTC, same key the browser log used. */
export function rotationDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The day a rotation belongs to, read from when it expires rather than from
 * the clock: a page that starts at 23:59 and renders past midnight is still
 * yesterday's store, and must not take today's row.
 *
 * The expiry is snapped to the nearest 00:00 UTC before stepping back a day.
 * It is never exact — Riot sends whole seconds left and the clock is read
 * after the fetch — so it lands either side of midnight, and an hour of drift
 * must not move the row to another day.
 */
export function rotationDateOf(expiresAt: Date): string {
  const midnight = Math.round(expiresAt.getTime() / DAY_MS) * DAY_MS;
  return rotationDate(new Date(midnight - DAY_MS));
}

/** Keep only what the history page shows. */
export function toHistoryItems(items: StoreItem[]): HistoryStoreItem[] {
  return items.map((item) => ({
    uuid: item.uuid,
    displayName: item.displayName,
    cost: item.cost,
    tierName: item.tierName,
    tierColor: item.tierColor,
  }));
}

interface Row {
  id: number | bigint;
  puuid: string;
  date: string;
  timestamp: number | bigint;
  expires_at: number | bigint;
  game_name: string | null;
  tag_line: string | null;
  items: string;
}

function toRotation(row: Row): StoreRotation {
  return {
    id: Number(row.id),
    puuid: row.puuid,
    date: row.date,
    timestamp: Number(row.timestamp),
    expiresAt: Number(row.expires_at),
    gameName: row.game_name ?? undefined,
    tagLine: row.tag_line ?? undefined,
    items: JSON.parse(row.items) as HistoryStoreItem[],
  };
}

/** Import only: a day the server already has is left alone. */
const INSERT_SQL = `
  INSERT OR IGNORE INTO store_rotations (puuid, date, timestamp, expires_at, game_name, tag_line, items)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`.trim();

/**
 * Recording: a later render of the same day replaces what it finds. The first
 * render can hold a skin the catalog did not know yet ("New Skin"), so the row
 * has to stay correctable; `timestamp` keeps pointing at the first sighting.
 */
const UPSERT_SQL = `
  INSERT INTO store_rotations (puuid, date, timestamp, expires_at, game_name, tag_line, items)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (puuid, date) DO UPDATE SET
    expires_at = excluded.expires_at,
    game_name  = COALESCE(excluded.game_name, store_rotations.game_name),
    tag_line   = COALESCE(excluded.tag_line, store_rotations.tag_line),
    items      = excluded.items
`.trim();

/**
 * Records a rotation for an account, one row per day (UNIQUE puuid+date), so
 * rendering the store twice does not double up. Returns true when the row was
 * written or refreshed.
 */
export async function recordStoreRotation(
  puuid: string,
  items: StoreItem[],
  expiresAt: Date,
  account?: { gameName?: string; tagLine?: string },
  now: Date = new Date(),
): Promise<boolean> {
  if (items.length === 0) return false;
  const db = await initSessionDb();
  const result = await db.execute({
    sql: UPSERT_SQL,
    args: [
      puuid,
      rotationDateOf(expiresAt),
      now.getTime(),
      expiresAt.getTime(),
      account?.gameName ?? null,
      account?.tagLine ?? null,
      JSON.stringify(toHistoryItems(items)),
    ],
  });
  const written = result.rowsAffected > 0;
  if (written) log.info("Recorded store rotation for PUUID:", puuid.substring(0, 8));
  return written;
}

/**
 * Imports rotations the browser logged before the server kept history.
 * Rows for a day that already exists are ignored. Returns how many were added.
 */
export async function importStoreRotations(rotations: StoreRotation[]): Promise<number> {
  if (rotations.length === 0) return 0;
  const db = await initSessionDb();
  const results = await db.batch(
    rotations.map((r) => ({
      sql: INSERT_SQL,
      args: [
        r.puuid,
        r.date,
        r.timestamp,
        r.expiresAt,
        r.gameName ?? null,
        r.tagLine ?? null,
        JSON.stringify(r.items),
      ],
    })),
    "write",
  );
  const added = results.reduce((n, r) => n + r.rowsAffected, 0);
  log.info(`Imported ${added} of ${rotations.length} browser-logged rotations`);
  return added;
}

/** Rotations for the given accounts, newest first. */
export async function getStoreRotations(puuids: string[], limit = 365): Promise<StoreRotation[]> {
  if (puuids.length === 0) return [];
  const db = await initSessionDb();
  const placeholders = puuids.map(() => "?").join(", ");
  const result = await db.execute({
    sql: `SELECT id, puuid, date, timestamp, expires_at, game_name, tag_line, items
          FROM store_rotations WHERE puuid IN (${placeholders})
          ORDER BY date DESC, id DESC LIMIT ?`,
    args: [...puuids, limit],
  });
  return result.rows.map((row) => toRotation(row as unknown as Row));
}

/** Deletes one rotation, only if it belongs to one of the given accounts. Returns true when a row went. */
export async function deleteStoreRotation(puuids: string[], id: number): Promise<boolean> {
  if (puuids.length === 0) return false;
  const db = await initSessionDb();
  const placeholders = puuids.map(() => "?").join(", ");
  const result = await db.execute({
    sql: `DELETE FROM store_rotations WHERE id = ? AND puuid IN (${placeholders})`,
    args: [id, ...puuids],
  });
  return result.rowsAffected > 0;
}
