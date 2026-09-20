import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ActHistory } from "./ActHistory";
import { RRProgressBar } from "./RRProgressBar";
import { RankDisplay } from "./RankDisplay";

afterEach(() => {
  cleanup();
});

describe("ActHistory", () => {
  it("renders nothing without acts", () => {
    const { container } = render(<ActHistory acts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("lists acts with end rank, games and win rate, newest first, capped by limit", () => {
    render(
      <ActHistory
        limit={2}
        acts={[
          { season: "v25a1", wins: 7, games: 10, endTierName: "Diamond 1" },
          { season: "e9a3", wins: 4, games: 10, endTierName: "Platinum 3" },
          { season: "e9a2", wins: 1, games: 2 },
        ]}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute("aria-label")).toBe("2025 · Act 1: Diamond 1, 7 wins in 10 games, 70 percent");
    expect(rows[1]!.getAttribute("aria-label")).toBe("Episode 9 · Act 3: Platinum 3, 4 wins in 10 games, 40 percent");
    expect(screen.getByText("70%")).toBeTruthy();
  });
});

describe("RRProgressBar — last game change", () => {
  it("shows a gain", () => {
    render(<RRProgressBar rankingInTier={40} lastChange={18} />);
    expect(screen.getByLabelText("gained 18 RR in the last game")).toBeTruthy();
  });

  it("shows a loss", () => {
    render(<RRProgressBar rankingInTier={40} lastChange={-7} />);
    expect(screen.getByLabelText("lost 7 RR in the last game")).toBeTruthy();
  });

  it("stays quiet when there was no change", () => {
    render(<RRProgressBar rankingInTier={40} lastChange={0} />);
    expect(screen.queryByText(/last game/)).toBeNull();
  });
});

describe("RankDisplay — extras", () => {
  it("shows the peak act and the leaderboard position", () => {
    render(
      <RankDisplay
        competitiveTierName="Immortal 2"
        peakTierName="Radiant"
        peakSeason="e8a2"
        leaderboardRank={1234}
      />,
    );
    expect(screen.getByText("Episode 8 · Act 2")).toBeTruthy();
    expect(screen.getByText("#1,234")).toBeTruthy();
  });

  it("unrated: says how many placement games are left", () => {
    render(<RankDisplay gamesNeededForRating={3} />);
    expect(screen.getByText("Unrated")).toBeTruthy();
    expect(screen.getByText("3 placement games to go")).toBeTruthy();
  });
});
