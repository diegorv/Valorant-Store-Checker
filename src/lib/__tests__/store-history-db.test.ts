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
  getStoreRotations,
  deleteStoreRotation,
  rotationDate,
  rotationDateOf,
} = await import("@/lib/store-history-db");

const { CREATE_STORE_ROTATIONS_TABLE, CREATE_STORE_ROTATIONS_INDEX } = await import(
  "@/lib/store-history-schema"
);

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
  it("writes one row per account and day", async () => {
    expect(await recordStoreRotation("p1", [item("a"), item("b")], EXPIRES, { gameName: "N", tagLine: "T" }, NOW)).toBe(true);

    const rows = await getStoreRotations(["p1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ puuid: "p1", date: "2026-09-20", gameName: "N", tagLine: "T", expiresAt: EXPIRES.getTime() });
    expect(rows[0]!.items.map((i) => i.uuid)).toEqual(["a", "b"]);
    expect(rows[0]!.items[0]).toEqual({ uuid: "a", displayName: "a", cost: 1775, tierName: "Premium", tierColor: "#d1548d" });
  });

  it("lets a later render of the same day correct the row instead of keeping the first one", async () => {
    // The first render can name a brand-new skin "New Skin"; the catalog catches up later
    await recordStoreRotation("p1", [item("New Skin")], EXPIRES, undefined, NOW);
    await recordStoreRotation("p1", [item("Spline Phantom")], EXPIRES, { gameName: "N", tagLine: "T" }, new Date("2026-09-20T18:00:00Z"));

    const rows = await getStoreRotations(["p1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.items.map((i) => i.uuid)).toEqual(["Spline Phantom"]);
    expect(rows[0]).toMatchObject({ gameName: "N", timestamp: NOW.getTime() }); // first sighting keeps the timestamp
  });

  it("keys the row on the day the rotation expires, not on when the page rendered", async () => {
    // Render crosses midnight: still yesterday's store, and today's row stays free
    await recordStoreRotation("p1", [item("a")], EXPIRES, undefined, new Date("2026-09-21T00:00:02Z"));
    await recordStoreRotation("p1", [item("b")], new Date("2026-09-22T00:00:00Z"), undefined, new Date("2026-09-21T00:00:03Z"));

    const rows = await getStoreRotations(["p1"]);
    expect(rows.map((r) => r.date)).toEqual(["2026-09-21", "2026-09-20"]);
  });

  it("does nothing for an empty store", async () => {
    expect(await recordStoreRotation("p1", [], EXPIRES, undefined, NOW)).toBe(false);
    expect(await getStoreRotations(["p1"])).toEqual([]);
  });

  it("keeps the account label when a later render has no active account", async () => {
    await recordStoreRotation("p1", [item("a")], EXPIRES, { gameName: "N", tagLine: "T" }, NOW);
    await recordStoreRotation("p1", [item("b")], EXPIRES, undefined, NOW);

    expect((await getStoreRotations(["p1"]))[0]).toMatchObject({ gameName: "N", tagLine: "T" });
  });

  it("keys the day in UTC", () => {
    expect(rotationDate(new Date("2026-09-20T23:59:59Z"))).toBe("2026-09-20");
    expect(rotationDate(new Date("2026-09-21T00:00:01Z"))).toBe("2026-09-21");
  });

  it("snaps the expiry to its midnight, whichever side of it Riot's expiry lands on", () => {
    // Riot sends whole seconds left and the clock is read after the fetch, so
    // the expiry drifts past midnight — the rotation is still the day before
    expect(rotationDateOf(new Date("2026-09-23T00:00:00.000Z"))).toBe("2026-09-22");
    expect(rotationDateOf(new Date("2026-09-23T00:00:00.250Z"))).toBe("2026-09-22");
    expect(rotationDateOf(new Date("2026-09-23T00:59:00Z"))).toBe("2026-09-22");
    expect(rotationDateOf(new Date("2026-09-22T23:59:30Z"))).toBe("2026-09-22");
  });
});

describe("getStoreRotations", () => {
  it("returns only the requested accounts, newest first, within the limit", async () => {
    const expiryAfter = (day: string) => new Date(`${day}T00:00:00Z`); // the rotation of the day before
    await recordStoreRotation("p1", [item("a")], expiryAfter("2026-09-19"), undefined, NOW);
    await recordStoreRotation("p1", [item("b")], expiryAfter("2026-09-21"), undefined, NOW);
    await recordStoreRotation("p2", [item("c")], expiryAfter("2026-09-20"), undefined, NOW);
    await recordStoreRotation("p3", [item("d")], expiryAfter("2026-09-22"), undefined, NOW);

    const rows = await getStoreRotations(["p1", "p2"]);
    expect(rows.map((r) => [r.puuid, r.date])).toEqual([["p1", "2026-09-20"], ["p2", "2026-09-19"], ["p1", "2026-09-18"]]);

    expect(await getStoreRotations(["p1", "p2"], 2)).toHaveLength(2);
    expect(await getStoreRotations([])).toEqual([]);
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
