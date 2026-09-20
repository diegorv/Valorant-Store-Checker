import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { InventoryCard } from "./InventoryCard";
import type { CollectionSkin } from "@/types/inventory";

afterEach(() => {
  cleanup();
});

function makeSkin(overrides: Partial<CollectionSkin> = {}): CollectionSkin {
  return {
    uuid: "skin-1",
    displayName: "Prime Vandal",
    owned: true,
    displayIcon: "https://media.valorant-api.com/prime-vandal.png",
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
    ...overrides,
  };
}

describe("InventoryCard — ownership", () => {
  it("owned skin: no ownership badge by default", () => {
    render(<InventoryCard skin={makeSkin()} />);

    expect(screen.queryByText(/not owned/i)).toBeNull();
    expect(screen.queryByText(/^owned$/i)).toBeNull();
    expect(screen.getByRole("article").getAttribute("aria-label")).not.toContain("not owned");
  });

  it("owned skin in a mixed view: shows the Owned badge", () => {
    render(<InventoryCard skin={makeSkin()} showOwnedBadge />);

    expect(screen.getByText(/^owned$/i)).toBeTruthy();
  });

  it("not owned skin: labelled, badged and dimmed", () => {
    render(<InventoryCard skin={makeSkin({ owned: false })} />);

    expect(screen.getByText(/not owned/i)).toBeTruthy();
    const article = screen.getByRole("article");
    expect(article.getAttribute("aria-label")).toContain("not owned");
    expect(article.getAttribute("data-owned")).toBe("false");
    expect(screen.getByAltText("Prime Vandal").className).toContain("grayscale");
  });
});
