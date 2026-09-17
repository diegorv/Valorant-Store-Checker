import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Mocks — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getSessionWithRefresh: vi.fn(async () => ({
    accessToken: "access",
    entitlementsToken: "entitlements",
    puuid: "puuid",
    region: "na",
  })),
}));

vi.mock("@/lib/store-service", () => ({
  fetchUserStore: vi.fn(async () => ({ dailyItems: [], bundles: [], nightMarket: null })),
  getWallet: vi.fn(),
}));

const StorePage = (await import("./page")).default;
const { SectionErrorBoundary } = await import("@/components/store/SectionErrorBoundary");
const { WalletSection } = await import("@/components/store/server/WalletSection");

// ---------------------------------------------------------------------------
// Helpers — walk the element tree the Server Component returns
// ---------------------------------------------------------------------------

/** Every element in the tree whose type matches, with its subtree. */
function findElements(node: ReactNode, type: unknown): React.ReactElement[] {
  const found: React.ReactElement[] = [];

  if (Array.isArray(node)) {
    for (const child of node) found.push(...findElements(child, type));
    return found;
  }

  if (!isValidElement(node)) return found;

  if (node.type === type) found.push(node);
  const props = node.props as { children?: ReactNode };
  found.push(...findElements(props.children, type));

  return found;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StorePage — section isolation", () => {
  it("wraps the wallet in a SectionErrorBoundary so a wallet failure cannot take down the page", async () => {
    const tree = await StorePage();

    const boundaries = findElements(tree, SectionErrorBoundary);
    const walletBoundary = boundaries.find(
      (boundary) => findElements(boundary, WalletSection).length > 0
    );

    expect(walletBoundary).toBeDefined();
  });

  it("uses the compact wallet fallback so it fits the narrow header slot", async () => {
    const tree = await StorePage();

    const walletBoundary = findElements(tree, SectionErrorBoundary).find(
      (boundary) => findElements(boundary, WalletSection).length > 0
    );

    expect((walletBoundary?.props as { compact?: boolean }).compact).toBe(true);
  });
});
