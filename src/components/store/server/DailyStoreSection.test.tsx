import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { StoreItem, StoreData } from "@/types/store";
import { DEFAULT_BLUR } from "@/lib/blur-utils";

// ---------------------------------------------------------------------------
// Mocks — the section is a server component, so everything it awaits is mocked
// ---------------------------------------------------------------------------

const mockCheckWishlistInStore = vi.fn();
vi.mock("@/lib/wishlist", () => ({
  checkWishlistInStore: (...args: unknown[]) => mockCheckWishlistInStore(...args),
}));

const mockRecordStoreRotation = vi.fn();
vi.mock("@/lib/store-history-db", () => ({
  recordStoreRotation: (...args: unknown[]) => mockRecordStoreRotation(...args),
}));

vi.mock("@/lib/accounts", () => ({
  getActiveAccount: async () => ({ puuid: "p1", gameName: "Player", tagLine: "NA1" }),
}));

vi.mock("@/hooks/useWishlist", () => ({
  useWishlist: () => ({ wishlistedUuids: [], isWishlisted: () => false, toggleWishlist: vi.fn() }),
}));

const { DailyStoreSection } = await import("./DailyStoreSection");

const ITEM: StoreItem = {
  uuid: "skin-1",
  displayName: "Spline Phantom",
  displayIcon: "/images/spline-phantom.png",
  streamedVideo: null,
  wallpaper: null,
  blurDataURL: DEFAULT_BLUR,
  cost: 1775,
  currencyId: "85ad13f7-3d1b-5128-8a35-80f2bb82406c",
  tierUuid: "e33df4d3-1c32-415c-899a-c6e47a16a936",
  tierName: "Premium Edition",
  tierColor: "#d1548d",
  chromaCount: 1,
  levelCount: 1,
  assetPath: "SkinsLibrary/Characters/Weapons/SplinePhantom",
};

const SESSION = {
  accessToken: "token",
  entitlementsToken: "ent",
  puuid: "p1",
  region: "na",
};

const STORE_DATA = { items: [ITEM], expiresAt: new Date("2026-09-23T00:00:00Z") } as StoreData;

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckWishlistInStore.mockResolvedValue([]);
  mockRecordStoreRotation.mockResolvedValue(true);
});

describe("DailyStoreSection", () => {
  it("renders the store and records the rotation", async () => {
    render(await DailyStoreSection({ session: SESSION, storeData: STORE_DATA }));

    expect(screen.getAllByText("Spline Phantom").length).toBeGreaterThan(0);
    expect(mockRecordStoreRotation).toHaveBeenCalledWith(
      "p1",
      STORE_DATA.items,
      STORE_DATA.expiresAt,
      { gameName: "Player", tagLine: "NA1" },
    );
  });

  it("still renders the store when recording the rotation fails", async () => {
    // A database hiccup must never cost the player their store
    mockRecordStoreRotation.mockRejectedValue(new Error("database is locked"));

    render(await DailyStoreSection({ session: SESSION, storeData: STORE_DATA }));

    expect(screen.getAllByText("Spline Phantom").length).toBeGreaterThan(0);
  });
});
