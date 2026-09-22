import { describe, it, expect } from "vitest";
import { columnsForWidth, MAX_COLUMNS } from "../collection-layout";

describe("columnsForWidth", () => {
  it("a phone gets a single column", () => {
    // iPhone-ish content width: 390px viewport minus the page padding
    expect(columnsForWidth(342)).toBe(1);
    expect(columnsForWidth(500)).toBe(1);
  });

  it("never fewer than one column, even before the container is measured", () => {
    expect(columnsForWidth(0)).toBe(1);
    expect(columnsForWidth(-10)).toBe(1);
    expect(columnsForWidth(Number.NaN)).toBe(1);
  });

  it("adds a column each time another card fits", () => {
    expect(columnsForWidth(600)).toBe(2);
    expect(columnsForWidth(960)).toBe(3);
    expect(columnsForWidth(1216)).toBe(4);
  });

  it("caps at the desktop layout on very wide screens", () => {
    expect(columnsForWidth(5000)).toBe(MAX_COLUMNS);
  });
});
