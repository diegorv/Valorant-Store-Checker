import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, screen } from "@testing-library/react";
import { AccountSwitcher } from "./AccountSwitcher";
import { AccountsProvider } from "./AccountsProvider";

const ACTIVE = {
  puuid: "active-puuid-0000",
  region: "na",
  gameName: "Active",
  tagLine: "0001",
  addedAt: 1,
  isActive: true,
};

function installFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "200",
    json: async () => ({ accounts: [ACTIVE] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AccountSwitcher mounted twice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists the accounts with a single request", async () => {
    // The header mounts the switcher twice — desktop nav and mobile drawer.
    // Fetching per instance meant two /api/accounts requests per page load.
    const fetchMock = installFetch();

    render(
      <AccountsProvider isLoggedIn>
        <AccountSwitcher />
        <AccountSwitcher />
      </AccountsProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Active#0001/)).toHaveLength(2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("issues no request while logged out", async () => {
    // The drawer is CSS-hidden rather than unmounted, so the provider is
    // mounted for signed-out visitors too; the endpoint would 401 them.
    const fetchMock = installFetch();

    render(
      <AccountsProvider isLoggedIn={false}>
        <span>header</span>
      </AccountsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("header")).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
