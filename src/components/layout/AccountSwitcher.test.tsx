import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountSwitcher } from "./AccountSwitcher";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTIVE = {
  puuid: "active-puuid-0000",
  region: "na",
  gameName: "Active",
  tagLine: "0001",
  addedAt: 1,
  isActive: true,
};

const STALE = {
  puuid: "stale-puuid-0000",
  region: "eu",
  gameName: "Stale",
  tagLine: "0002",
  addedAt: 2,
  isActive: false,
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  };
}

/**
 * fetch stub backed by a tiny in-memory registry.
 *
 * GET /api/accounts serves the registry; DELETE answers with `deleteStatus`
 * and, unless it failed for a real reason (5xx), leaves the registry holding
 * only the active account — so a refetch is observable in the rendered list.
 */
function installFetch(deleteStatus: number) {
  const registry = { accounts: [ACTIVE, STALE] };

  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      if (deleteStatus < 500) registry.accounts = [ACTIVE];
      return jsonResponse(
        deleteStatus,
        deleteStatus === 200 ? { success: true } : { error: "Account not found" },
      );
    }
    return jsonResponse(200, { accounts: registry.accounts });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function listCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method !== "DELETE",
  );
}

async function openDropdownAndRemove() {
  const user = userEvent.setup();
  await screen.findByText(/Active#0001/);
  await user.click(screen.getByRole("button", { name: /Active#0001/ }));
  const removeButton = await screen.findByLabelText("Remove account");
  await user.click(removeButton);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AccountSwitcher — removing an account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("reconciles the list when the DELETE responds 404 (account already gone)", async () => {
    // The local list is stale: the registry no longer holds STALE, so the
    // route answers 404. The switcher must still refetch and drop the row.
    const fetchMock = installFetch(404);

    render(<AccountSwitcher />);
    await openDropdownAndRemove();

    await waitFor(() => {
      expect(listCalls(fetchMock).length).toBe(2);
    });
    await waitFor(() => {
      expect(screen.queryByText(/Stale#0002/)).toBeNull();
    });
  });

  it("reconciles the list when the DELETE responds 200", async () => {
    const fetchMock = installFetch(200);

    render(<AccountSwitcher />);
    await openDropdownAndRemove();

    await waitFor(() => {
      expect(listCalls(fetchMock).length).toBe(2);
    });
    await waitFor(() => {
      expect(screen.queryByText(/Stale#0002/)).toBeNull();
    });
  });

  it("does not refetch when the DELETE fails for a real reason (500)", async () => {
    const fetchMock = installFetch(500);

    render(<AccountSwitcher />);
    await openDropdownAndRemove();

    // Give any stray refetch a chance to happen before asserting
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
        ),
      ).toBe(true);
    });

    expect(listCalls(fetchMock).length).toBe(1);
    expect(screen.queryByText(/Stale#0002/)).not.toBeNull();
  });
});
