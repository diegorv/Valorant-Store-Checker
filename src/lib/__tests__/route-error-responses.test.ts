import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { SessionData } from "@/lib/schemas/session";

// ---------------------------------------------------------------------------
// Error bodies of the routes without a suite of their own (wishlist, profile,
// accounts/switch). Every failure answers with `{ error, code }`.
// ---------------------------------------------------------------------------

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
  getSessionWithRefresh: vi.fn(),
}));

vi.mock("@/lib/accounts", () => ({
  switchAccount: vi.fn(),
  getActiveAccount: vi.fn(),
}));

vi.mock("@/lib/wishlist", () => ({
  getWishlist: vi.fn(),
  addToWishlist: vi.fn(),
  removeFromWishlist: vi.fn(),
}));

vi.mock("@/lib/profile-cache", () => ({
  getProfileData: vi.fn(),
}));

vi.mock("@/lib/riot-store", () => ({}));

const wishlistRoute = await import("@/app/api/wishlist/route");
const profileRoute = await import("@/app/api/profile/route");
const switchRoute = await import("@/app/api/accounts/switch/route");

const SESSION: SessionData = {
  accessToken: "token",
  entitlementsToken: "ent-token",
  puuid: "session-puuid",
  region: "na",
  createdAt: 1700000000000,
};

const ITEM = {
  skinUuid: "skin-1",
  displayName: "Skin",
  displayIcon: "https://example.com/icon.png",
  tierColor: "#ffffff",
};

function makeRequest(url: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { getSession, getSessionWithRefresh } = await import("@/lib/session");
  vi.mocked(getSession).mockResolvedValue(SESSION);
  vi.mocked(getSessionWithRefresh).mockResolvedValue(SESSION);
});

describe("/api/wishlist error responses", () => {
  it("GET 500", async () => {
    const { getWishlist } = await import("@/lib/wishlist");
    vi.mocked(getWishlist).mockRejectedValue(new Error("redis down"));

    const res = await wishlistRoute.GET(makeRequest("/api/wishlist"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to fetch wishlist", code: "INTERNAL_ERROR" });
  });

  it("POST 500", async () => {
    const { addToWishlist } = await import("@/lib/wishlist");
    vi.mocked(addToWishlist).mockRejectedValue(new Error("redis down"));

    const res = await wishlistRoute.POST(makeRequest("/api/wishlist", "POST", ITEM));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to add item to wishlist", code: "INTERNAL_ERROR" });
  });

  it("POST 400 on a body that fails validation", async () => {
    const res = await wishlistRoute.POST(makeRequest("/api/wishlist", "POST", { skinUuid: "skin-1" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String), code: "VALIDATION_ERROR" });
  });

  it("DELETE 500", async () => {
    const { removeFromWishlist } = await import("@/lib/wishlist");
    vi.mocked(removeFromWishlist).mockRejectedValue(new Error("redis down"));

    const res = await wishlistRoute.DELETE(makeRequest("/api/wishlist", "DELETE", { skinUuid: "skin-1" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to remove item from wishlist", code: "INTERNAL_ERROR" });
  });
});

describe("/api/profile error responses", () => {
  it("GET 500", async () => {
    const { getProfileData } = await import("@/lib/profile-cache");
    vi.mocked(getProfileData).mockRejectedValue(new Error("henrik down"));

    const res = await profileRoute.GET(makeRequest("/api/profile"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to fetch profile data", code: "INTERNAL_ERROR" });
  });
});

describe("/api/accounts/switch error responses", () => {
  it("POST 404 when the account cannot be switched to", async () => {
    const { switchAccount } = await import("@/lib/accounts");
    vi.mocked(switchAccount).mockResolvedValue(false);

    const res = await switchRoute.POST(makeRequest("/api/accounts/switch", "POST", { puuid: "missing" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Failed to switch account. Account may not exist or session may be expired.",
      code: "NOT_FOUND",
    });
  });

  it("POST 500", async () => {
    const { switchAccount } = await import("@/lib/accounts");
    vi.mocked(switchAccount).mockRejectedValue(new Error("cookie store down"));

    const res = await switchRoute.POST(makeRequest("/api/accounts/switch", "POST", { puuid: "p" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to switch account", code: "INTERNAL_ERROR" });
  });

  it("POST 400 on an empty puuid", async () => {
    const res = await switchRoute.POST(makeRequest("/api/accounts/switch", "POST", { puuid: "" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String), code: "VALIDATION_ERROR" });
  });
});
