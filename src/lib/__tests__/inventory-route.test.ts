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
});
