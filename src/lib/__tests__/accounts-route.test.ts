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
    expect(body).toEqual({ error: "Account not found", code: "NOT_FOUND" });
  });

  it("returns 400 when no puuid is provided", async () => {
    const res = await DELETE(
      new NextRequest("http://localhost/api/accounts", { method: "DELETE" })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "PUUID is required", code: "VALIDATION_ERROR" });
  });

  it("returns 500 with a code when the registry cannot be updated", async () => {
    const { removeAccount } = await import("@/lib/accounts");
    vi.mocked(removeAccount).mockRejectedValue(new Error("cookie store down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await DELETE(makeDeleteRequest("existing-puuid"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to remove account", code: "INTERNAL_ERROR" });
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

  it("returns an empty list when no registry exists yet", async () => {
    const { getAccounts, addAccount } = await import("@/lib/accounts");
    vi.mocked(getAccounts).mockResolvedValue(null);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toEqual([]);
    // Building the registry here would rotate the caller's session on a read
    expect(addAccount).not.toHaveBeenCalled();
    expect(getAccounts).toHaveBeenCalledTimes(1);
  });

  it("returns 500 with a code when the registry cannot be read", async () => {
    const { getAccounts } = await import("@/lib/accounts");
    vi.mocked(getAccounts).mockRejectedValue(new Error("cookie store down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to retrieve accounts", code: "INTERNAL_ERROR" });
  });
});
