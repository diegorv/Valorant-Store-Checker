import { describe, it, expect } from "vitest";
import { computeHistoryStats, EMPTY_HISTORY_STATS } from "@/lib/history-stats";
import type { StoreRotation } from "@/types/history";

function rotation(date: string, skins: Array<[uuid: string, cost: number]>): StoreRotation {
  return {
    date,
    timestamp: Date.parse(date),
    puuid: "p",
    expiresAt: Date.parse(date) + 86_400_000,
    items: skins.map(([uuid, cost]) => ({ uuid, displayName: uuid.toUpperCase(), cost, tierName: null, tierColor: "#fff" })),
  };
}

describe("computeHistoryStats", () => {
  it("returns the empty stats for no rotations", () => {
    expect(computeHistoryStats([])).toEqual(EMPTY_HISTORY_STATS);
  });

  it("counts rotations, unique skins, the most offered skin and the average daily cost", () => {
    const stats = computeHistoryStats([
      rotation("2026-09-20", [["prime", 1775], ["reaver", 1775], ["oni", 1275], ["glitch", 2175]]),
      rotation("2026-09-19", [["prime", 1775], ["ion", 1775], ["oni", 1275], ["sov", 2175]]),
    ]);
    expect(stats.totalRotationsSeen).toBe(2);
    expect(stats.uniqueSkinsOffered).toBe(6);
    expect(stats.mostOfferedSkin).toEqual({ uuid: "prime", displayName: "PRIME", count: 2 });
    expect(stats.averageDailyCost).toBe(7000);
  });
});
