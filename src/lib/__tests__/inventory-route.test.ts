import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { SessionData } from "@/lib/schemas/session";

// ---------------------------------------------------------------------------
// Mocks — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
  getSessionWithRefresh: vi.fn(),
}));

vi.mock("@/lib/riot-inventory", () => ({
  getOwnedSkins: vi.fn(),
  clearInventoryCache: vi.fn(),
}));

vi.mock("@/lib/inventory-cache", () => ({
  getCachedInventory: vi.fn(),
  clearCachedInventory: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Dynamic import of route AFTER mocks
// ---------------------------------------------------------------------------

const { GET } = await import("@/app/api/inventory/route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION: SessionData = {
  accessToken: "token",
  entitlementsToken: "ent-token",
  puuid: "session-puuid",
  region: "na",
  createdAt: 1700000000000,
};

const UPSTREAM_MESSAGE = "Riot PD 403: {\"errorCode\":\"BAD_CLAIMS\",\"httpStatus\":403}";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/inventory — upstream failure response", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { getSessionWithRefresh } = await import("@/lib/session");
    vi.mocked(getSessionWithRefresh).mockResolvedValue(SESSION);

    const { getOwnedSkins } = await import("@/lib/riot-inventory");
    vi.mocked(getOwnedSkins).mockRejectedValue(new Error(UPSTREAM_MESSAGE));

    const { getCachedInventory } = await import("@/lib/inventory-cache");
    vi.mocked(getCachedInventory).mockReturnValue(null);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("does not echo the raw upstream error to the client", async () => {
    const response = await GET(new NextRequest("http://localhost/api/inventory"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to fetch inventory data", code: "RIOT_API_ERROR" });
    expect(JSON.stringify(body)).not.toContain("BAD_CLAIMS");
  });

  it("still records the upstream error in the server log", async () => {
    await GET(new NextRequest("http://localhost/api/inventory"));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Inventory API"),
      "Inventory fetch failed:",
      expect.objectContaining({ message: UPSTREAM_MESSAGE }),
    );
  });

  it("an unexpected failure answers with the generic server-error code", async () => {
    const { getCachedInventory } = await import("@/lib/inventory-cache");
    vi.mocked(getCachedInventory).mockImplementation(() => {
      throw new Error("cache exploded");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(new NextRequest("http://localhost/api/inventory"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to fetch inventory data", code: "INTERNAL_ERROR" });
    errorSpy.mockRestore();
  });
});


describe("GET /api/inventory — catalog side is opt-in", () => {
  const OWNED = { uuid: "owned-1", owned: true };
  const UNOWNED = { uuid: "unowned-1", owned: false };
  const DATA = {
    skins: [OWNED],
    totalCount: 1,
    unownedSkins: [UNOWNED],
    catalogCount: 2,
    weaponCategories: ["Vandal"],
    editionCategories: [],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getSessionWithRefresh } = await import("@/lib/session");
    vi.mocked(getSessionWithRefresh).mockResolvedValue(SESSION);
    const { getOwnedSkins } = await import("@/lib/riot-inventory");
    vi.mocked(getOwnedSkins).mockResolvedValue(DATA as never);
  });

  it("without catalog=true: owned skins only, unownedSkins stripped, counts kept", async () => {
    const response = await GET(new NextRequest("http://localhost/api/inventory"));
    const body = await response.json();

    expect(body.skins).toEqual([OWNED]);
    expect(body.unownedSkins).toEqual([]);
    expect(body.catalogCount).toBe(2);
  });

  it("with catalog=true: the unowned side is included", async () => {
    const response = await GET(new NextRequest("http://localhost/api/inventory?catalog=true"));
    const body = await response.json();

    expect(body.skins).toEqual([OWNED]);
    expect(body.unownedSkins).toEqual([UNOWNED]);
  });
});
