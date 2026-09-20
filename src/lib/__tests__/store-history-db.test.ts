import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import type { StoreItem } from "@/types/store";

// ---------------------------------------------------------------------------
// Mocks — an in-memory LibSQL database stands in for session-db
// ---------------------------------------------------------------------------

let client: Client;
vi.mock("@/lib/session-db", () => ({
  initSessionDb: async () => client,
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const {
  recordStoreRotation,
  importStoreRotations,
  getStoreRotations,
  deleteStoreRotation,
  rotationDate,
  CREATE_STORE_ROTATIONS_TABLE,
  CREATE_STORE_ROTATIONS_INDEX,
} = await import("@/lib/store-history-db");

function item(uuid: string, cost = 1775): StoreItem {
  return {
    uuid,
    displayName: uuid,
    displayIcon: "",
    streamedVideo: null,
    wallpaper: null,
    blurDataURL: "",
    cost,
    currencyId: "vp",
    tierUuid: null,
    tierName: "Premium",
    tierColor: "#d1548d",
    chromaCount: 1,
    levelCount: 1,
    assetPath: "",
    weaponName: "Vandal",
  } as StoreItem;
}

const NOW = new Date("2026-09-20T12:00:00Z");
const EXPIRES = new Date("2026-09-21T00:00:00Z");

beforeEach(async () => {
  client = createClient({ url: "file::memory:" });
  await client.execute(CREATE_STORE_ROTATIONS_TABLE);
  await client.execute(CREATE_STORE_ROTATIONS_INDEX);
});

describe("recordStoreRotation", () => {
  it("writes one row per account and day, and ignores a second write for the same day", async () => {
    expect(await recordStoreRotation("p1", [item("a"), item("b")], EXPIRES, { gameName: "N", tagLine: "T" }, NOW)).toBe(true);
    expect(await recordStoreRotation("p1", [item("c")], EXPIRES, undefined, NOW)).toBe(false);

    const rows = await getStoreRotations(["p1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ puuid: "p1", date: "2026-09-20", gameName: "N", tagLine: "T", expiresAt: EXPIRES.getTime() });
    expect(rows[0]!.items.map((i) => i.uuid)).toEqual(["a", "b"]);
    expect(rows[0]!.items[0]).toEqual({ uuid: "a", displayName: "a", cost: 1775, tierName: "Premium", tierColor: "#d1548d" });
  });

  it("does nothing for an empty store", async () => {
    expect(await recordStoreRotation("p1", [], EXPIRES, undefined, NOW)).toBe(false);
    expect(await getStoreRotations(["p1"])).toEqual([]);
  });

  it("keys the day in UTC", () => {
    expect(rotationDate(new Date("2026-09-20T23:59:59Z"))).toBe("2026-09-20");
    expect(rotationDate(new Date("2026-09-21T00:00:01Z"))).toBe("2026-09-21");
  });
});

describe("getStoreRotations", () => {
  it("returns only the requested accounts, newest first, within the limit", async () => {
    await recordStoreRotation("p1", [item("a")], EXPIRES, undefined, new Date("2026-09-18T12:00:00Z"));
    await recordStoreRotation("p1", [item("b")], EXPIRES, undefined, new Date("2026-09-20T12:00:00Z"));
    await recordStoreRotation("p2", [item("c")], EXPIRES, undefined, new Date("2026-09-19T12:00:00Z"));
    await recordStoreRotation("p3", [item("d")], EXPIRES, undefined, new Date("2026-09-21T12:00:00Z"));

    const rows = await getStoreRotations(["p1", "p2"]);
    expect(rows.map((r) => [r.puuid, r.date])).toEqual([["p1", "2026-09-20"], ["p2", "2026-09-19"], ["p1", "2026-09-18"]]);

    expect(await getStoreRotations(["p1", "p2"], 2)).toHaveLength(2);
    expect(await getStoreRotations([])).toEqual([]);
  });
});

describe("importStoreRotations", () => {
  it("adds browser-logged days and skips the ones the server already has", async () => {
    await recordStoreRotation("p1", [item("server")], EXPIRES, undefined, new Date("2026-09-20T12:00:00Z"));

    const added = await importStoreRotations([
      { puuid: "p1", date: "2026-09-20", timestamp: 1, expiresAt: 2, items: [{ uuid: "browser", displayName: "x", cost: 1, tierName: null, tierColor: "#000" }] },
      { puuid: "p1", date: "2026-09-10", timestamp: 1, expiresAt: 2, gameName: "Old", items: [{ uuid: "old", displayName: "x", cost: 1, tierName: null, tierColor: "#000" }] },
    ]);

    expect(added).toBe(1);
    const rows = await getStoreRotations(["p1"]);
    expect(rows.map((r) => [r.date, r.items[0]!.uuid])).toEqual([["2026-09-20", "server"], ["2026-09-10", "old"]]);
    expect(await importStoreRotations([])).toBe(0);
  });
});

describe("deleteStoreRotation", () => {
  it("deletes only rows that belong to one of the given accounts", async () => {
    await recordStoreRotation("p1", [item("a")], EXPIRES, undefined, NOW);
    await recordStoreRotation("p2", [item("b")], EXPIRES, undefined, NOW);
    const [mine, theirs] = await Promise.all([getStoreRotations(["p1"]), getStoreRotations(["p2"])]);

    expect(await deleteStoreRotation(["p1"], theirs[0]!.id!)).toBe(false);
    expect(await deleteStoreRotation(["p1"], mine[0]!.id!)).toBe(true);
    expect(await deleteStoreRotation([], 1)).toBe(false);
    expect(await getStoreRotations(["p1", "p2"])).toHaveLength(1);
  });
});
