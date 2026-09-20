import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RecentMatches, formatRelative, formatRelativeCompact } from "./RecentMatches";
import { MatchStatsSummary } from "./MatchStatsSummary";
import type { RecentMatch, MatchStats } from "@/lib/match-stats";

afterEach(() => {
  cleanup();
});

const MATCH: RecentMatch = {
  id: "m1", map: "Haven", agent: "Killjoy", agentId: "kj", startedAt: "2026-09-20T10:00:00Z",
  result: "loss", roundsWon: 10, roundsLost: 13, kills: 14, deaths: 16, assists: 6, shotsHit: 61, headshots: 14, headshotPct: 23, damageDealt: 2400, score: 3200,
};

describe("RecentMatches", () => {
  it("renders nothing without matches", () => {
    const { container } = render(<RecentMatches matches={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("describes each match from the player's point of view", () => {
    render(<RecentMatches matches={[MATCH]} />);
    const row = screen.getByRole("listitem");
    expect(row.getAttribute("aria-label")).toBe(
      "Defeat 10 to 13 on Haven as Killjoy, 14 kills 16 deaths 6 assists, 23 percent headshots",
    );
    expect(screen.getByText("14 / 16 / 6")).toBeTruthy();
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-09-20T12:00:00Z");
  it("picks minutes, hours or days", () => {
    expect(formatRelative("2026-09-20T11:30:00Z", now)).toBe("30 minutes ago");
    expect(formatRelative("2026-09-20T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatRelative("2026-09-17T12:00:00Z", now)).toBe("3 days ago");
    expect(formatRelative("not a date", now)).toBe("");
  });
});

describe("formatRelativeCompact", () => {
  const now = Date.parse("2026-09-20T12:00:00Z");
  it("is one number and one letter", () => {
    expect(formatRelativeCompact("2026-09-20T11:59:40Z", now)).toBe("now");
    expect(formatRelativeCompact("2026-09-20T11:30:00Z", now)).toBe("30m");
    expect(formatRelativeCompact("2026-09-20T09:00:00Z", now)).toBe("3h");
    expect(formatRelativeCompact("2026-09-13T12:00:00Z", now)).toBe("7d");
    expect(formatRelativeCompact("not a date", now)).toBe("");
  });
});

describe("MatchStatsSummary", () => {
  const stats: MatchStats = {
    games: 3, wins: 2, losses: 1, draws: 0, winRate: 67, kd: 1.5, kda: 1.9, headshotPct: 25,
    avgDamage: 2900, avgScore: 4100, form: ["win", "loss", "win"],
    topAgents: [{ name: "Jett", agentId: "jett", games: 2, wins: 2, winRate: 100 }],
  };

  it("shows the tiles, the form strip and the top agents", () => {
    render(<MatchStatsSummary stats={stats} />);
    expect(screen.getByText("67%")).toBeTruthy();
    expect(screen.getByText("1.50")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getAllByRole("listitem", { name: /^(win|loss|draw)$/ })).toHaveLength(3);
    expect(screen.getByLabelText("Jett: 2 games, 100 percent win rate")).toBeTruthy();
  });

  it("renders nothing without stats", () => {
    const { container } = render(<MatchStatsSummary />);
    expect(container.firstChild).toBeNull();
  });
});
