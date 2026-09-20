import { describe, it, expect } from "vitest";
import { toRecentMatch, toRecentMatches, aggregateMatchStats } from "@/lib/match-stats";
import type { HenrikStoredMatch } from "@/lib/schemas/henrik";

function stored(overrides: {
  id?: string; map?: string; agent?: string; team?: string; red?: number | null; blue?: number | null;
  kills?: number; deaths?: number; assists?: number; head?: number; body?: number; leg?: number;
  dealt?: number; score?: number; startedAt?: string;
} = {}): HenrikStoredMatch {
  return {
    meta: {
      id: overrides.id ?? "m1",
      map: { id: "map-1", name: overrides.map ?? "Ascent" },
      mode: "Competitive",
      started_at: overrides.startedAt ?? "2026-09-20T10:00:00Z",
      season: { id: "s", short: "v26a2" },
    },
    stats: {
      team: overrides.team ?? "Red",
      character: { id: "agent-1", name: overrides.agent ?? "Jett" },
      tier: 12,
      score: overrides.score ?? 4000,
      kills: overrides.kills ?? 20,
      deaths: overrides.deaths ?? 10,
      assists: overrides.assists ?? 5,
      shots: { head: overrides.head ?? 10, body: overrides.body ?? 30, leg: overrides.leg ?? 10 },
      damage: { dealt: overrides.dealt ?? 3000, received: 2500 },
    },
    // "in" rather than ??: a test may pass null on purpose
    teams: { red: "red" in overrides ? overrides.red! : 13, blue: "blue" in overrides ? overrides.blue! : 7 },
  };
}

describe("toRecentMatch", () => {
  it("reads the result from the player's team and the round score", () => {
    expect(toRecentMatch(stored({ team: "Red", red: 13, blue: 7 }))?.result).toBe("win");
    expect(toRecentMatch(stored({ team: "Blue", red: 13, blue: 7 }))?.result).toBe("loss");
    expect(toRecentMatch(stored({ team: "blue", red: 12, blue: 12 }))?.result).toBe("draw");
  });

  it("orients rounds from the player's side and computes headshot % over shots that hit", () => {
    const m = toRecentMatch(stored({ team: "Blue", red: 13, blue: 7, head: 10, body: 30, leg: 10 }))!;
    expect(m.roundsWon).toBe(7);
    expect(m.roundsLost).toBe(13);
    expect(m.headshotPct).toBe(20);
  });

  it("drops a match whose score is unreadable", () => {
    expect(toRecentMatch(stored({ red: null }))).toBeNull();
    expect(toRecentMatch(stored({ team: "Yellow" }))).toBeNull();
  });
});

describe("toRecentMatches", () => {
  it("sorts newest first", () => {
    const list = toRecentMatches([
      stored({ id: "old", startedAt: "2026-09-18T10:00:00Z" }),
      stored({ id: "new", startedAt: "2026-09-20T10:00:00Z" }),
    ]);
    expect(list.map((m) => m.id)).toEqual(["new", "old"]);
  });
});

describe("aggregateMatchStats", () => {
  const matches = toRecentMatches([
    stored({ id: "1", agent: "Jett", team: "Red", red: 13, blue: 5, kills: 25, deaths: 10, assists: 3, dealt: 4000, score: 6000, startedAt: "2026-09-20T12:00:00Z" }),
    stored({ id: "2", agent: "Jett", team: "Red", red: 8, blue: 13, kills: 15, deaths: 15, assists: 5, dealt: 2500, score: 3500, startedAt: "2026-09-20T11:00:00Z" }),
    stored({ id: "3", agent: "Omen", team: "Blue", red: 12, blue: 12, kills: 10, deaths: 5, assists: 10, dealt: 2000, score: 3000, startedAt: "2026-09-20T10:00:00Z" }),
    stored({ id: "4", agent: "Sova", team: "Blue", red: 4, blue: 13, kills: 20, deaths: 10, assists: 2, dealt: 3500, score: 5000, startedAt: "2026-09-20T09:00:00Z" }),
  ]);

  it("counts results, win rate over decided games, K/D, averages and the form strip", () => {
    const stats = aggregateMatchStats(matches)!;
    expect(stats.games).toBe(4);
    expect([stats.wins, stats.losses, stats.draws]).toEqual([2, 1, 1]);
    expect(stats.winRate).toBe(67); // 2 of 3 decided
    expect(stats.kd).toBe(1.75);   // 70 / 40
    expect(stats.kda).toBe(2.25);  // 90 / 40
    expect(stats.avgDamage).toBe(3000);
    expect(stats.avgScore).toBe(4375);
    expect(stats.form).toEqual(["win", "loss", "draw", "win"]);
  });

  it("ranks agents by games played, then win rate", () => {
    const stats = aggregateMatchStats(matches, 2)!;
    expect(stats.topAgents.map((a) => [a.name, a.games, a.winRate])).toEqual([
      ["Jett", 2, 50],
      ["Sova", 1, 100],
    ]);
  });

  it("returns null with no matches and never divides by zero deaths", () => {
    expect(aggregateMatchStats([])).toBeNull();
    const stats = aggregateMatchStats(toRecentMatches([stored({ deaths: 0, kills: 7 })]))!;
    expect(stats.kd).toBe(7);
  });
});
