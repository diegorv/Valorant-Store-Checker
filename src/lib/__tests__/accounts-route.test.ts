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

vi.mock("@/lib/accounts", () => ({
  getAccounts: vi.fn(),
  addAccount: vi.fn(),
  removeAccount: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Dynamic import of route AFTER mocks
// ---------------------------------------------------------------------------

const { GET, DELETE } = await import("@/app/api/accounts/route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeleteRequest(puuid: string): NextRequest {
  return new NextRequest(`http://localhost/api/accounts?puuid=${puuid}`, {
    method: "DELETE",
  });
}

function makeGetRequest(): NextRequest {
  return new NextRequest("http://localhost/api/accounts");
}

const SESSION: SessionData = {
  accessToken: "token",
  entitlementsToken: "ent-token",
  puuid: "session-puuid",
  region: "na",
  createdAt: 1700000000000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DELETE /api/accounts (with session)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { getSession } = await import("@/lib/session");
    vi.mocked(getSession).mockResolvedValue(SESSION);
  });

  it("returns 200 when the account was removed", async () => {
    const { removeAccount } = await import("@/lib/accounts");
    vi.mocked(removeAccount).mockResolvedValue(true);

    const res = await DELETE(makeDeleteRequest("existing-puuid"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 404 when the puuid is not in the registry", async () => {
    const { removeAccount } = await import("@/lib/accounts");
    vi.mocked(removeAccount).mockResolvedValue(false);

    const res = await DELETE(makeDeleteRequest("missing-puuid"));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Account not found");
  });

  it("returns 400 when no puuid is provided", async () => {
    const res = await DELETE(
      new NextRequest("http://localhost/api/accounts", { method: "DELETE" })
    );

    expect(res.status).toBe(400);
  });
});

describe("GET /api/accounts (with session)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { getSession } = await import("@/lib/session");
    vi.mocked(getSession).mockResolvedValue(SESSION);
  });

  it("returns the registry accounts with the active one flagged", async () => {
    const { getAccounts, addAccount } = await import("@/lib/accounts");
    vi.mocked(getAccounts).mockResolvedValue({
      accounts: [
        { puuid: "session-puuid", region: "na", addedAt: 1 },
        { puuid: "other-puuid", region: "eu", addedAt: 2 },
      ],
      activePuuid: "session-puuid",
    });

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts[0].isActive).toBe(true);
    expect(body.accounts[1].isActive).toBe(false);
    // Nothing to migrate — the registry already exists
    expect(addAccount).not.toHaveBeenCalled();
  });

  it("migrates the guarded session into a missing registry", async () => {
    const { getAccounts, addAccount } = await import("@/lib/accounts");
    vi.mocked(getAccounts)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        accounts: [{ puuid: "session-puuid", region: "na", addedAt: 1700000000000 }],
        activePuuid: "session-puuid",
      });

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    // The migration uses the session handed over by withSession
    expect(addAccount).toHaveBeenCalledWith(
      expect.objectContaining({ puuid: "session-puuid", addedAt: 1700000000000 }),
      expect.objectContaining({ puuid: "session-puuid", accessToken: "token" })
    );
    const body = await res.json();
    expect(body.accounts).toHaveLength(1);
  });
});
