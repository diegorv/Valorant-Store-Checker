import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AccountLevelBadge, resolveAccountLevel } from "./AccountLevelBadge";

afterEach(() => {
  cleanup();
});

describe("resolveAccountLevel", () => {
  it("prefers Riot's level when it is positive", () => {
    expect(resolveAccountLevel(120, 118)).toEqual({ level: 120, source: "riot" });
  });

  it("falls back to Henrik when Riot reports 0 (level hidden in game)", () => {
    expect(resolveAccountLevel(0, 118)).toEqual({ level: 118, source: "henrik" });
  });

  it("keeps a zero when nobody knows better, and undefined when nothing came", () => {
    expect(resolveAccountLevel(0, 0)).toEqual({ level: 0, source: "none" });
    expect(resolveAccountLevel(undefined, undefined)).toEqual({ level: undefined, source: "none" });
  });
});

describe("AccountLevelBadge", () => {
  it("hidden in game with a Henrik value: shows Henrik's level and says it is hidden in game", () => {
    render(<AccountLevelBadge accountLevel={0} henrikAccountLevel={118} hideAccountLevel />);
    expect(screen.getByText("118")).toBeTruthy();
    expect(screen.getByText("Hidden in game")).toBeTruthy();
  });

  it("hidden in game with no other source: shows a dash instead of 0", () => {
    render(<AccountLevelBadge accountLevel={0} hideAccountLevel />);
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("visible level: no hidden tag", () => {
    render(<AccountLevelBadge accountLevel={57} henrikAccountLevel={57} hideAccountLevel={false} />);
    expect(screen.getByText("57")).toBeTruthy();
    expect(screen.queryByText(/hidden/i)).toBeNull();
  });
});
