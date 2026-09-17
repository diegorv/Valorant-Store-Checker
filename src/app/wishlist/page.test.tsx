import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import WishlistPage from "./page";

const { replace, redirect } = vi.hoisted(() => ({
  replace: vi.fn(),
  // The real redirect() works by throwing an Error("NEXT_REDIRECT") that has to
  // propagate — inside a try/catch it is swallowed like any other error. Keeping
  // the throw here means reintroducing redirect() inside the try fails these
  // tests instead of silently passing against an inert vi.fn().
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/wishlist",
}));

const unauthorized = () =>
  ({ ok: false, status: 401, json: async () => ({}) }) as Response;

// Lets the 401 branch run to completion without depending on the navigation
// itself, so the UI assertion below still runs when the redirect is swallowed.
async function settle() {
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalled();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("WishlistPage — expired session", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockResolvedValue(unauthorized());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("navigates to the login page when the wishlist answers 401", async () => {
    render(<WishlistPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/login");
    });
  });

  it("never shows a framework-internal identifier in the UI", async () => {
    render(<WishlistPage />);
    await settle();

    expect(screen.queryByText(/NEXT_REDIRECT/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/NEXT_REDIRECT/);
  });
});
