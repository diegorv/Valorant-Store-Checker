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
const mockImportStoreRotations = vi.fn();
vi.mock("@/lib/store-history-db", () => ({
  getStoreRotations: (...args: unknown[]) => mockGetStoreRotations(...args),
  deleteStoreRotation: (...args: unknown[]) => mockDeleteStoreRotation(...args),
  importStoreRotations: (...args: unknown[]) => mockImportStoreRotations(...args),
}));

const { GET, DELETE, POST } = await import("@/app/api/history/route");

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
  });
});

describe("DELETE /api/history", () => {
  it("deletes within the allowed accounts and reports 404 when nothing matched", async () => {
    mockDeleteStoreRotation.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    expect((await DELETE(jsonRequest("DELETE", { id: 7 }))).status).toBe(200);
    expect(mockDeleteStoreRotation).toHaveBeenCalledWith(["active-puuid", "other-puuid"], 7);
    expect((await DELETE(jsonRequest("DELETE", { id: 8 }))).status).toBe(404);
  });

  it("400 on a bad id", async () => {
    expect((await DELETE(jsonRequest("DELETE", { id: "x" }))).status).toBe(400);
  });
});

describe("POST /api/history (import)", () => {
  it("imports rotations for allowed accounts only and reports the rest as skipped", async () => {
    mockImportStoreRotations.mockResolvedValue(1);

    const response = await POST(jsonRequest("POST", {
      rotations: [ROTATION, { ...ROTATION, puuid: "stranger-puuid", date: "2026-09-19" }],
    }));
    const body = await response.json();

    expect(mockImportStoreRotations).toHaveBeenCalledWith([ROTATION]);
    expect(body).toEqual({ imported: 1, skipped: 1 });
  });

  it("400 on a malformed rotation", async () => {
    const response = await POST(jsonRequest("POST", { rotations: [{ ...ROTATION, date: "20/09/2026" }] }));
    expect(response.status).toBe(400);
    expect(mockImportStoreRotations).not.toHaveBeenCalled();
  });
});
