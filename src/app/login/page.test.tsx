import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionData } from "@/lib/schemas/session";

// ---------------------------------------------------------------------------
// Mocks — all declared before any imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

const mockGetSessionWithRefresh = vi.fn();
vi.mock("@/lib/session", () => ({
  getSessionWithRefresh: () => mockGetSessionWithRefresh(),
}));

vi.mock("@/components/auth/LoginFormLoader", () => ({
  LoginFormLoader: () => null,
}));

const LoginPage = (await import("./page")).default;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function render(searchParams: { addAccount?: string } = {}) {
  return LoginPage({ searchParams: Promise.resolve(searchParams) });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LoginPage — redirect decision", () => {
  // /store sends the user here when getSessionWithRefresh() returns null. This
  // page must never send them straight back, or the browser loops until it
  // fails with "too many redirects".
  it("no usable session: renders the form, does not redirect", async () => {
    mockGetSessionWithRefresh.mockResolvedValue(null);

    await render();

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("session whose Riot refresh failed: keeps the form so the user can log in again", async () => {
    mockGetSessionWithRefresh.mockResolvedValue(makeSession({ _refreshFailed: true }));

    await render();

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("usable session: redirects to /store", async () => {
    mockGetSessionWithRefresh.mockResolvedValue(makeSession());

    await render();

    expect(mockRedirect).toHaveBeenCalledWith("/store");
  });

  it("addAccount flow: skips the session check entirely", async () => {
    mockGetSessionWithRefresh.mockResolvedValue(makeSession());

    await render({ addAccount: "1" });

    expect(mockGetSessionWithRefresh).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
