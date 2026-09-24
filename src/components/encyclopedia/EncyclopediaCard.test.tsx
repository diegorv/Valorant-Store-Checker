import { describe, it, expect, vi, afterEach } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EncyclopediaCard } from "./EncyclopediaCard";
import { EncyclopediaClient } from "./EncyclopediaClient";
import type { EncyclopediaSkin } from "@/types/encyclopedia";

const mockSkin: EncyclopediaSkin = {
  uuid: "skin-123",
  displayName: "Prime Vandal",
  displayIcon: "/images/prime-vandal.png",
  wallpaper: null,
  weaponName: "Vandal",
  tierName: "Select Edition",
  tierColor: "#5A9FE2",
  contentTierUuid: null,
};

describe("EncyclopediaCard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Optimistic UI", () => {
    it("reconciles with the prop when the parent rolls a rejected toggle back", async () => {
      const user = userEvent.setup();
      const onWishlistToggle = vi.fn();

      const { container, rerender } = render(
        <EncyclopediaCard
          skin={mockSkin}
          isWishlisted={false}
          onWishlistToggle={onWishlistToggle}
        />
      );

      const card = within(container);
      await user.click(card.getByRole("button", { name: /add to wishlist/i }));
      expect(card.getByRole("button", { name: /remove from wishlist/i })).toBeTruthy();

      // Parent applies its own optimistic update
      rerender(
        <EncyclopediaCard
          skin={mockSkin}
          isWishlisted={true}
          onWishlistToggle={onWishlistToggle}
        />
      );

      // Server rejected it — parent rolls back to the real state
      rerender(
        <EncyclopediaCard
          skin={mockSkin}
          isWishlisted={false}
          onWishlistToggle={onWishlistToggle}
        />
      );

      expect(card.getByRole("button", { name: /add to wishlist/i })).toBeTruthy();
    });
  });

  // End-to-end over the real tree (EncyclopediaClient -> EncyclopediaGrid -> EncyclopediaCard).
  // The parent already rolls a rejected toggle back; only the card pins its override,
  // so the heart keeps lying about a skin that is not on the wishlist.
  describe("Server rejection reverts the heart (integration with EncyclopediaClient)", () => {
    function mockWishlistApi(toggleResponse: Partial<Response>) {
      return vi
        .spyOn(global, "fetch")
        .mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
          // The mount fetch has no method; the toggle fetch is POST/DELETE
          if (!init?.method) {
            return { ok: true, json: async () => ({ items: [] }) } as Response;
          }
          return toggleResponse as Response;
        });
    }

    function renderEncyclopedia() {
      return render(
        <EncyclopediaClient skins={[mockSkin]} tiers={[]} tierMap={new Map()} />
      );
    }

    it("puts the heart back when the API answers 401", async () => {
      mockWishlistApi({ ok: false, status: 401, statusText: "Unauthorized" });
      const user = userEvent.setup();

      const card = within(renderEncyclopedia().container);
      await user.click(await card.findByRole("button", { name: /add to wishlist/i }));

      const heart = card.getByRole("button", { name: /add to wishlist/i });
      expect(heart).toBeTruthy();
      // The accessible label and the filled/unfilled heart must agree
      expect(heart.querySelector("svg")?.getAttribute("class")).toContain("fill-none");
    });

    it("the heart the user sees after a rejected toggle sends an add", async () => {
      const fetchSpy = mockWishlistApi({ ok: false, status: 401, statusText: "Unauthorized" });
      const user = userEvent.setup();

      const card = within(renderEncyclopedia().container);
      await user.click(await card.findByRole("button", { name: /add to wishlist/i }));
      await user.click(card.getByRole("button", { name: /add to wishlist/i }));

      const methods = fetchSpy.mock.calls
        .map(([, init]) => (init as RequestInit | undefined)?.method)
        .filter(Boolean);
      expect(methods).toEqual(["POST", "POST"]);
    });

    it("keeps the heart filled when the API accepts the toggle", async () => {
      mockWishlistApi({ ok: true, status: 200, statusText: "OK" });
      const user = userEvent.setup();

      const card = within(renderEncyclopedia().container);
      await user.click(await card.findByRole("button", { name: /add to wishlist/i }));

      expect(card.getByRole("button", { name: /remove from wishlist/i })).toBeTruthy();
    });
  });
});
