import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { InventoryGrid } from "./InventoryGrid";
import type { CollectionSkin } from "@/types/inventory";

// happy-dom does no layout, so every element is 0px by 0px. The grid reads
// the scroll container's clientWidth to pick its column count, and the
// virtualizer reads offsetWidth/offsetHeight to know how many rows are on
// screen; stub them per test so rows actually render.
let containerWidth = 0;
const SIZE_PROPS = ["clientWidth", "offsetWidth", "offsetHeight"] as const;
const originals = SIZE_PROPS.map((prop) => [prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)] as const);

beforeEach(() => {
  for (const prop of SIZE_PROPS) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get() {
        return prop === "offsetHeight" ? 800 : containerWidth;
      },
    });
  }
});

afterEach(() => {
  cleanup();
  for (const [prop, descriptor] of originals) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, prop, descriptor);
    else delete (HTMLElement.prototype as Partial<Record<typeof prop, number>>)[prop];
  }
});

function makeSkin(i: number): CollectionSkin {
  return {
    uuid: `skin-${i}`,
    displayName: `Skin ${i}`,
    owned: true,
    displayIcon: `https://media.valorant-api.com/skin-${i}.png`,
    streamedVideo: null,
    wallpaper: null,
    blurDataURL: "data:image/png;base64,",
    tierUuid: "tier-1",
    tierName: "Premium Edition",
    tierColor: "#d1548d",
    chromaCount: 4,
    levelCount: 4,
    assetPath: "",
    weaponName: "Vandal",
  };
}

const skins = Array.from({ length: 5 }, (_, i) => makeSkin(i));

function renderGrid() {
  return render(<InventoryGrid skins={skins} weaponCategories={["Vandal"]} editionCategories={[]} />);
}

function cardsPerRow(): number[] {
  return screen.getAllByTestId("collection-row").map((row) => row.querySelectorAll("[role='article']").length);
}

function firstRowColumns(): string | undefined {
  const grid = screen.getAllByTestId("collection-row")[0]?.firstElementChild;
  return grid instanceof HTMLElement ? grid.style.gridTemplateColumns : undefined;
}

describe("InventoryGrid — rows follow the width", () => {
  it("phone: one card per row, so a filter with several skins never stacks four into one row", () => {
    containerWidth = 342;
    renderGrid();

    expect(cardsPerRow().length).toBeGreaterThan(1);
    expect(cardsPerRow().every((n) => n === 1)).toBe(true);
    expect(firstRowColumns()).toBe("repeat(1, minmax(0, 1fr))");
  });

  it("desktop: four cards per row, the last row holds the remainder", () => {
    containerWidth = 1216;
    renderGrid();

    expect(cardsPerRow()).toEqual([4, 1]);
    expect(firstRowColumns()).toBe("repeat(4, minmax(0, 1fr))");
  });

  it("rows are measured, not given a fixed height", () => {
    containerWidth = 342;
    renderGrid();

    for (const row of screen.getAllByTestId("collection-row")) {
      expect(row.style.height).toBe("");
      expect(row.getAttribute("data-index")).not.toBeNull();
    }
  });
});
