import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactNode } from "react";
import type { SessionData } from "@/lib/schemas/session";
import { RiotStoreHttpError } from "@/lib/riot-store";

// ---------------------------------------------------------------------------
// Mocks — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

// The real redirect() signals by throwing and terminates the render, so this
// mock throws too — a no-op would let the page appear to carry on past it.
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

const mockGetSessionWithRefresh = vi.fn();
const mockRevokeCurrentSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSessionWithRefresh: () => mockGetSessionWithRefresh(),
  revokeCurrentSession: () => mockRevokeCurrentSession(),
}));

const mockFetchUserStore = vi.fn();
vi.mock("@/lib/store-service", () => ({
  fetchUserStore: () => mockFetchUserStore(),
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

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    accessToken: "access",
    entitlementsToken: "entitlements",
    puuid: "puuid",
    region: "na",
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionWithRefresh.mockResolvedValue(makeSession());
  mockFetchUserStore.mockResolvedValue({ items: [], expiresAt: new Date(), bundles: [] });
});

describe("StorePage — unusable session", () => {
  // The store used to render its error panel here and decide "Session Expired"
  // from the error message, which production redacts to a digest. The decision
  // belongs to the server, before any boundary exists.
  it("session whose Riot refresh failed: goes to login instead of fetching with a dead token", async () => {
    mockGetSessionWithRefresh.mockResolvedValue(makeSession({ _refreshFailed: true }));

    await expect(StorePage()).rejects.toThrow("NEXT_REDIRECT /login");

    expect(mockRedirect).toHaveBeenCalledWith("/login");
    expect(mockFetchUserStore).not.toHaveBeenCalled();
  });

  it("Riot rejects the tokens with 401: drops the session and goes to login", async () => {
    mockFetchUserStore.mockRejectedValue(new RiotStoreHttpError(401, "no entitlements"));

    await expect(StorePage()).rejects.toThrow("NEXT_REDIRECT /login");

    // Without the drop, /login still considers the session usable and sends the
    // browser straight back here.
    expect(mockRevokeCurrentSession).toHaveBeenCalledOnce();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("other upstream failures still reach the error boundary", async () => {
    mockFetchUserStore.mockRejectedValue(new RiotStoreHttpError(503, "maintenance"));

    await expect(StorePage()).rejects.toThrow(RiotStoreHttpError);

    expect(mockRevokeCurrentSession).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

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
