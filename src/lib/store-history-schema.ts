/**
 * Store history schema.
 *
 * Kept apart from store-history-db so session-db can create the table without
 * importing the module that reads and writes it (and that imports session-db
 * back). The tests build the same table from here.
 */

export const CREATE_STORE_ROTATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS store_rotations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    puuid      TEXT    NOT NULL,
    date       TEXT    NOT NULL,
    timestamp  INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    game_name  TEXT,
    tag_line   TEXT,
    items      TEXT    NOT NULL,
    UNIQUE (puuid, date)
  )
`.trim();

export const CREATE_STORE_ROTATIONS_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_store_rotations_puuid_date ON store_rotations(puuid, date)
`.trim();
