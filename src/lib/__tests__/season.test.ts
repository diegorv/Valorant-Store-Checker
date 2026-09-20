import { describe, it, expect } from "vitest";
import { formatSeasonShort, formatSeasonCompact, compareSeasonShortDesc } from "@/lib/season";

describe("formatSeasonShort", () => {
  it("expands episode-era codes", () => {
    expect(formatSeasonShort("e8a2")).toBe("Episode 8 · Act 2");
    expect(formatSeasonShort("E1A1")).toBe("Episode 1 · Act 1");
  });

  it("expands yearly codes", () => {
    expect(formatSeasonShort("v25a1")).toBe("2025 · Act 1");
  });

  it("leaves unknown codes readable", () => {
    expect(formatSeasonShort("beta")).toBe("BETA");
  });
});

describe("formatSeasonCompact", () => {
  it("keeps both eras short", () => {
    expect(formatSeasonCompact("e8a2")).toBe("E8 A2");
    expect(formatSeasonCompact("v25a3")).toBe("2025 A3");
  });
});

describe("compareSeasonShortDesc", () => {
  it("sorts newest first, yearly after every episode", () => {
    const sorted = ["e8a2", "v25a1", "e9a3", "e8a3", "v25a2", "e2a1"].sort(compareSeasonShortDesc);
    expect(sorted).toEqual(["v25a2", "v25a1", "e9a3", "e8a3", "e8a2", "e2a1"]);
  });
});
