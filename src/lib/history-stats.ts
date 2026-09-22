/**
 * Store history statistics — pure, safe on client and server.
 */

import type { StoreRotation, HistoryStats } from "@/types/history";

export const EMPTY_HISTORY_STATS: HistoryStats = {
  totalRotationsSeen: 0,
  uniqueSkinsOffered: 0,
  mostOfferedSkin: { uuid: "", displayName: "N/A", count: 0 },
  averageDailyCost: 0,
};

export function computeHistoryStats(rotations: StoreRotation[]): HistoryStats {
  if (rotations.length === 0) return EMPTY_HISTORY_STATS;

  const skinCounts = new Map<string, { displayName: string; count: number }>();
  let totalCost = 0;

  for (const rotation of rotations) {
    for (const item of rotation.items) {
      totalCost += item.cost;
      const existing = skinCounts.get(item.uuid);
      if (existing) existing.count++;
      else skinCounts.set(item.uuid, { displayName: item.displayName, count: 1 });
    }
  }

  let mostOfferedSkin = { uuid: "", displayName: "N/A", count: 0 };
  for (const [uuid, data] of skinCounts) {
    if (data.count > mostOfferedSkin.count) mostOfferedSkin = { uuid, ...data };
  }

  return {
    totalRotationsSeen: rotations.length,
    uniqueSkinsOffered: skinCounts.size,
    mostOfferedSkin,
    averageDailyCost: totalCost / rotations.length,
  };
}
