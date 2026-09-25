import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RiotStorefront } from "@/types/riot";
import type { StoreStaticData } from "@/lib/store-service";
import { ITEM_TYPE_WEAPON_SKIN, CURRENCY_IDS } from "@/lib/constants";
import { DEFAULT_TIER_COLOR } from "@/types/store";

// ---------------------------------------------------------------------------
// Mocks — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

vi.mock("@/lib/riot-store", () => ({
  getStorefront: vi.fn(),
  getWallet: vi.fn(),
}));

vi.mock("@/lib/valorant-api", () => ({
  getWeaponSkins: vi.fn(),
  getContentTiers: vi.fn(),
  getSkinVideo: vi.fn(() => null),
  getBundleByUuid: vi.fn(),
  getSkinLevelByUuid: vi.fn(),
  getBuddyLevelByUuid: vi.fn(),
  getSprayByUuid: vi.fn(),
  getPlayerCardByUuid: vi.fn(),
  getPlayerTitleByUuid: vi.fn(),
}));

const mockLogWarn = vi.fn();
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockLogWarn,
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are declared
// ---------------------------------------------------------------------------

const { hydrateNightMarket } = await import("@/lib/store-service");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const KNOWN_SKIN_UUID = "known-skin-uuid";
const UNKNOWN_SKIN_UUID = "unknown-skin-uuid";

const STATIC_DATA = {
  skins: [
    {
      uuid: KNOWN_SKIN_UUID,
      displayName: "Known Skin",
      displayIcon: "https://example.test/known.png",
      wallpaper: null,
      contentTierUuid: null,
      assetPath: "Known/Asset/Path",
      chromas: [],
      levels: [],
    },
  ],
  tiers: [],
} as unknown as StoreStaticData;

function makeBonusOffer(skinUuid: string, basePrice: number, discountedPrice: number, discountPercent: number, isSeen: boolean) {
  return {
    BonusOfferID: `bonus-${skinUuid}`,
    Offer: {
      OfferID: `offer-${skinUuid}`,
      IsDirectPurchase: true,
      StartDate: "2026-01-01T00:00:00Z",
      Cost: { [CURRENCY_IDS.VP]: basePrice },
      Rewards: [{ ItemTypeID: ITEM_TYPE_WEAPON_SKIN, ItemID: skinUuid, Quantity: 1 }],
    },
    DiscountPercent: discountPercent,
    DiscountCosts: { [CURRENCY_IDS.VP]: discountedPrice },
    IsSeen: isSeen,
  };
}

function makeStorefront(offers: ReturnType<typeof makeBonusOffer>[]): RiotStorefront {
  return {
    BonusStore: {
      BonusStoreOffers: offers,
      BonusStoreRemainingDurationInSeconds: 3600,
    },
  } as unknown as RiotStorefront;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hydrateNightMarket", () => {
  beforeEach(() => {
    mockLogWarn.mockClear();
  });

  it("keeps an offer whose skin is missing from the catalog, with the offer's real pricing", async () => {
    const storefront = makeStorefront([
      makeBonusOffer(KNOWN_SKIN_UUID, 1775, 887, 50, true),
      makeBonusOffer(UNKNOWN_SKIN_UUID, 2175, 1305, 40, false),
    ]);

    const result = await hydrateNightMarket(storefront, STATIC_DATA);

    expect(result?.items).toHaveLength(2);
    const placeholder = result?.items.find((i) => i.uuid === UNKNOWN_SKIN_UUID);
    expect(placeholder).toMatchObject({
      uuid: UNKNOWN_SKIN_UUID,
      displayName: "Unknown Skin",
      basePrice: 2175,
      discountedPrice: 1305,
      discountPercent: 40,
      currencyId: CURRENCY_IDS.VP,
      tierColor: DEFAULT_TIER_COLOR,
      isSeen: false,
    });
  });

  it("still returns the Night Market when no offer can be identified", async () => {
    const storefront = makeStorefront([
      makeBonusOffer(UNKNOWN_SKIN_UUID, 2175, 1305, 40, true),
      makeBonusOffer("another-unknown-uuid", 1775, 532, 70, false),
    ]);

    const result = await hydrateNightMarket(storefront, STATIC_DATA);

    expect(result).toBeDefined();
    expect(result?.items.map((i) => i.uuid)).toEqual([UNKNOWN_SKIN_UUID, "another-unknown-uuid"]);
    expect(result?.items.map((i) => i.isSeen)).toEqual([true, false]);
  });

  it("logs the skin id of an offer it cannot identify", async () => {
    const storefront = makeStorefront([makeBonusOffer(UNKNOWN_SKIN_UUID, 2175, 1305, 40, false)]);

    await hydrateNightMarket(storefront, STATIC_DATA);

    expect(mockLogWarn).toHaveBeenCalledTimes(1);
    expect(mockLogWarn.mock.calls[0]).toContain(UNKNOWN_SKIN_UUID);
  });
});
