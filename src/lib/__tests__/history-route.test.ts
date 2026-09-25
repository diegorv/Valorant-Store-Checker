import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { SessionData } from "@/lib/schemas/session";

// ---------------------------------------------------------------------------
// Mocks — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
  getSessionWithRefresh: vi.fn(),
}));

const mockGetAccounts = vi.fn();
vi.mock("@/lib/accounts", () => ({
  getAccounts: () => mockGetAccounts(),
}));

const mockGetStoreRotations = vi.fn();
const mockDeleteStoreRotation = vi.fn();
vi.mock("@/lib/store-history-db", () => ({
  getStoreRotations: (...args: unknown[]) => mockGetStoreRotations(...args),
  deleteStoreRotation: (...args: unknown[]) => mockDeleteStoreRotation(...args),
}));

const { GET, DELETE } = await import("@/app/api/history/route");

const SESSION: SessionData = {
  accessToken: "token",
  entitlementsToken: "ent-token",
  puuid: "active-puuid",
  region: "na",
  createdAt: 1700000000000,
};

const ROTATION = {
  puuid: "active-puuid",
  date: "2026-09-20",
  timestamp: 1,
  expiresAt: 2,
  items: [{ uuid: "a", displayName: "A", cost: 1775, tierName: null, tierColor: "#fff" }],
};

function jsonRequest(method: string, body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/history", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { getSession } = await import("@/lib/session");
  vi.mocked(getSession).mockResolvedValue(SESSION);
  mockGetAccounts.mockResolvedValue({ accounts: [{ puuid: "active-puuid" }, { puuid: "other-puuid" }], activePuuid: "active-puuid" });
});

describe("GET /api/history", () => {
  it("lists rotations for the active account and every linked account", async () => {
    mockGetStoreRotations.mockResolvedValue([ROTATION]);

    const response = await GET(new NextRequest("http://localhost/api/history"));
    const body = await response.json();

    expect(mockGetStoreRotations).toHaveBeenCalledWith(["active-puuid", "other-puuid"], 365);
    expect(body.rotations).toEqual([ROTATION]);
  });

  it("falls back to the session account when there is no registry", async () => {
    mockGetAccounts.mockResolvedValue(null);
    mockGetStoreRotations.mockResolvedValue([]);

    await GET(new NextRequest("http://localhost/api/history"));

    expect(mockGetStoreRotations).toHaveBeenCalledWith(["active-puuid"], 365);
  });

  it("401 without a session", async () => {
    const { getSession } = await import("@/lib/session");
    vi.mocked(getSession).mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/history"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
  });

  it("500 with the same code as every other server failure", async () => {
    mockGetStoreRotations.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(new NextRequest("http://localhost/api/history"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load history", code: "INTERNAL_ERROR" });
  });
});

describe("DELETE /api/history", () => {
  it("deletes within the allowed accounts and reports 404 when nothing matched", async () => {
    mockDeleteStoreRotation.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    expect((await DELETE(jsonRequest("DELETE", { id: 7 }))).status).toBe(200);
    expect(mockDeleteStoreRotation).toHaveBeenCalledWith(["active-puuid", "other-puuid"], 7);
    const notFound = await DELETE(jsonRequest("DELETE", { id: 8 }));
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: "Rotation not found", code: "NOT_FOUND" });
  });

  it("400 on a bad id", async () => {
    const response = await DELETE(jsonRequest("DELETE", { id: "x" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String), code: "VALIDATION_ERROR" });
  });

  it("400 on a body that is not JSON", async () => {
    const response = await DELETE(
      new NextRequest("http://localhost/api/history", { method: "DELETE", body: "{not json" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON in request body", code: "VALIDATION_ERROR" });
  });

  it("500 when the delete fails", async () => {
    mockDeleteStoreRotation.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await DELETE(jsonRequest("DELETE", { id: 7 }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to delete rotation", code: "INTERNAL_ERROR" });
  });
});
