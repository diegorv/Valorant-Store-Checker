import { createClient, type Client } from "@libsql/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Helpers — session-db.ts resolves its file path at import time, so each test
// picks a unique path, resets the module registry and clears the global client.
// Every seeded database carries one live session row so the sessions.json
// migration (which only runs against an empty sessions table) stays inert.
// ---------------------------------------------------------------------------

const createdDbPaths: string[] = [];

function makeDbPath(name: string): string {
  const relPath = `.session-data/test-${name}-${Date.now()}.db`;
  createdDbPaths.push(path.join(process.cwd(), relPath));
  return relPath;
}

async function seedDb(
  relPath: string,
  legacyRows: Array<[sessionId: string, puuid: string, skins: string]>,
): Promise<void> {
  const absPath = path.join(process.cwd(), relPath);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-owned path under .session-data; not user input
  fs.mkdirSync(path.dirname(absPath), { recursive: true });

  const client = createClient({ url: "file:" + absPath.replace(/\\/g, "/") });
  await client.execute(
    "CREATE TABLE sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL)",
  );
  await client.execute({
    sql: "INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)",
    args: ["seed-session", "{}", Date.now() + 60_000],
  });

  if (legacyRows.length > 0) {
    await client.execute(
      "CREATE TABLE wishlists (session_id TEXT NOT NULL, puuid TEXT NOT NULL, skins TEXT NOT NULL, PRIMARY KEY (session_id, puuid))",
    );
    for (const [sessionId, puuid, skins] of legacyRows) {
      await client.execute({
        sql: "INSERT INTO wishlists (session_id, puuid, skins) VALUES (?, ?, ?)",
        args: [sessionId, puuid, skins],
      });
    }
  }

  client.close();
}

async function loadSessionDb(relPath: string): Promise<Client> {
  process.env.SESSION_DB_PATH = relPath;
  (globalThis as { __sessionDb?: Client }).__sessionDb = undefined;
  vi.resetModules();
  const { initSessionDb } = await import("@/lib/session-db");
  return initSessionDb();
}

afterEach(() => {
  const globals = globalThis as {
    __sessionDb?: Client;
    __cleanupInterval?: ReturnType<typeof setInterval>;
  };
  if (globals.__cleanupInterval) {
    clearInterval(globals.__cleanupInterval);
    globals.__cleanupInterval = undefined;
  }
  globals.__sessionDb?.close();
  globals.__sessionDb = undefined;
  delete process.env.SESSION_DB_PATH;

  for (const dbPath of createdDbPaths.splice(0)) {
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(dbPath + suffix, { force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wishlists key migration", () => {
  it("rebuilds a legacy table keeping the most recent row per puuid", async () => {
    const relPath = makeDbPath("legacy");
    await seedDb(relPath, [
      ["session-old", "puuid-a", JSON.stringify([{ skinUuid: "stale" }])],
      ["session-new", "puuid-a", JSON.stringify([{ skinUuid: "fresh" }])],
      ["session-old", "puuid-b", JSON.stringify([{ skinUuid: "other-account" }])],
    ]);

    const client = await loadSessionDb(relPath);

    const columns = await client.execute("PRAGMA table_info(wishlists)");
    expect(columns.rows.map((row) => row.name)).toEqual(["puuid", "skins"]);
    expect(columns.rows.find((row) => row.name === "puuid")?.pk).toBe(1);

    const rows = await client.execute("SELECT puuid, skins FROM wishlists ORDER BY puuid");
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]!.puuid).toBe("puuid-a");
    expect(JSON.parse(rows.rows[0]!.skins as string)).toEqual([{ skinUuid: "fresh" }]);
    expect(rows.rows[1]!.puuid).toBe("puuid-b");
    expect(JSON.parse(rows.rows[1]!.skins as string)).toEqual([{ skinUuid: "other-account" }]);
  });

  it("leaves an already-migrated database untouched on a later init", async () => {
    const relPath = makeDbPath("idempotent");
    await seedDb(relPath, [["session-old", "puuid-a", JSON.stringify([{ skinUuid: "kept" }])]]);

    const firstClient = await loadSessionDb(relPath);
    firstClient.close();
    const client = await loadSessionDb(relPath);

    const columns = await client.execute("PRAGMA table_info(wishlists)");
    expect(columns.rows.map((row) => row.name)).toEqual(["puuid", "skins"]);

    const rows = await client.execute("SELECT puuid, skins FROM wishlists");
    expect(rows.rows).toHaveLength(1);
    expect(JSON.parse(rows.rows[0]!.skins as string)).toEqual([{ skinUuid: "kept" }]);
  });

  it("creates the puuid-keyed table on a database without wishlists", async () => {
    const relPath = makeDbPath("fresh");
    await seedDb(relPath, []);

    const client = await loadSessionDb(relPath);

    const columns = await client.execute("PRAGMA table_info(wishlists)");
    expect(columns.rows.map((row) => row.name)).toEqual(["puuid", "skins"]);
  });
});
