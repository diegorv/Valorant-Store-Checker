import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { parseWithLog } from "@/lib/schemas/parse";
import { RiotWalletSchema } from "@/lib/schemas/storefront";
import { CURRENCY_IDS } from "@/types/riot";

// ---------------------------------------------------------------------------
// Mocks — the section is a server component, so everything it awaits is mocked
// ---------------------------------------------------------------------------

const mockGetWallet = vi.fn();
vi.mock("@/lib/store-service", () => ({
  getWallet: (...args: unknown[]) => mockGetWallet(...args),
}));

const { WalletSection } = await import("./WalletSection");

const SESSION = {
  accessToken: "token",
  entitlementsToken: "ent",
  puuid: "p1",
  region: "na",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("WalletSection", () => {
  it("renders an unavailable state when the wallet response fails the schema", async () => {
    // Exactly what getWallet returns for a body that is not a wallet: the
    // schema rejects it and parseWithLog yields null.
    mockGetWallet.mockResolvedValue(
      parseWithLog(RiotWalletSchema, { errorCode: "BAD_CLAIMS" }, "RiotWallet"),
    );

    render(await WalletSection({ session: SESSION }));

    // A balance the user makes purchase decisions on must never be invented
    expect(screen.queryAllByText("0")).toHaveLength(0);
    expect(screen.getByText("Wallet Unavailable")).toBeTruthy();
    expect(screen.getByRole("region").getAttribute("aria-label")).toBe(
      "Wallet: balance unavailable",
    );
  });

  it("renders an unavailable state when the wallet carries no VP or RP balance", async () => {
    // The schema accepts an empty Balances map, so a valid 200 can still
    // arrive without the currencies the display needs.
    mockGetWallet.mockResolvedValue(
      parseWithLog(RiotWalletSchema, { Balances: {} }, "RiotWallet"),
    );

    render(await WalletSection({ session: SESSION }));

    expect(screen.queryAllByText("0")).toHaveLength(0);
    expect(screen.getByRole("region").getAttribute("aria-label")).toBe(
      "Wallet: balance unavailable",
    );
  });

  it("renders a genuine zero balance as zero", async () => {
    mockGetWallet.mockResolvedValue({
      Balances: {
        [CURRENCY_IDS.VP]: 0,
        [CURRENCY_IDS.RP]: 0,
        [CURRENCY_IDS.KC]: 0,
      },
    });

    render(await WalletSection({ session: SESSION }));

    // VP and RP — a zero KC is hidden by WalletDisplay
    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.getByRole("region").getAttribute("aria-label")).toBe(
      "Wallet: 0 Valorant Points, 0 Radianite Points",
    );
  });

  it("renders a wallet without Kingdom Credits", async () => {
    mockGetWallet.mockResolvedValue({
      Balances: {
        [CURRENCY_IDS.VP]: 5000,
        [CURRENCY_IDS.RP]: 250,
      },
    });

    render(await WalletSection({ session: SESSION }));

    expect(screen.getByRole("region").getAttribute("aria-label")).toBe(
      "Wallet: 5,000 Valorant Points, 250 Radianite Points",
    );
  });
});
