import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StoreCard } from "./StoreCard";
import { StoreGrid } from "./StoreGrid";
import { useWishlist } from "@/hooks/useWishlist";
import type { StoreItem } from "@/types/store";
import { DEFAULT_BLUR } from "@/lib/blur-utils";

const mockStoreItem: StoreItem = {
  uuid: "skin-123",
  displayName: "Prime Vandal",
  displayIcon: "/images/prime-vandal.png",
  streamedVideo: null,
  wallpaper: null,
  blurDataURL: DEFAULT_BLUR,
  cost: 1775,
  currencyId: "85ad13f7-3d1b-5128-8a35-80f2bb82406c",
  tierUuid: "e33df4d3-1c32-415c-899a-c6e47a16a936",
  tierName: "Select Edition",
  tierColor: "#5A9FE2",
  chromaCount: 4,
  levelCount: 5,
  assetPath: "SkinsLibrary/Characters/Weapons/PrimeVandal",
};

describe("StoreCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Renders skin name and price", () => {
    it("displays the skin name", () => {
      render(<StoreCard item={mockStoreItem} />);
      expect(screen.getByText("Prime Vandal")).toBeTruthy();
    });

    it("displays the formatted price", () => {
      render(<StoreCard item={mockStoreItem} />);
      // Use querySelector to find the price span
      const priceSpan = document.querySelector("span.text-xl.font-mono");
      expect(priceSpan?.textContent).toBe("1,775");
    });
  });

  describe("Wishlist toggle", () => {
    it("calls onWishlistToggle with skin uuid and item when heart is clicked", async () => {
      const user = userEvent.setup();
      const onWishlistToggle = vi.fn();

      render(
        <StoreCard
          item={mockStoreItem}
          onWishlistToggle={onWishlistToggle}
        />
      );

      const heartButton = screen.getByRole("button", { name: /add to wishlist/i });
      await user.click(heartButton);

      expect(onWishlistToggle).toHaveBeenCalledTimes(1);
      expect(onWishlistToggle).toHaveBeenCalledWith(
        "skin-123",
        expect.objectContaining({ uuid: "skin-123", displayName: "Prime Vandal" })
      );
    });
  });

  describe("Video preview", () => {
    it("does not render video when streamedVideo is null", () => {
      render(<StoreCard item={mockStoreItem} />);
      const video = document.querySelector("video");
      expect(video).toBeFalsy();
    });

    it("renders an article element for the card", () => {
      render(<StoreCard item={mockStoreItem} />);
      const articles = document.querySelectorAll("[role='article']");
      expect(articles.length).toBeGreaterThan(0);
    });
  });

  describe("Optimistic UI", () => {
    it("calls onWishlistToggle when API call is made", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response);

      const onWishlistToggle = vi.fn();
      const user = userEvent.setup();

      render(
        <StoreCard
          item={mockStoreItem}
          isWishlisted={false}
          onWishlistToggle={onWishlistToggle}
        />
      );

      const heartButton = screen.getByRole("button", { name: /add to wishlist/i });
      await user.click(heartButton);

      expect(onWishlistToggle).toHaveBeenCalledWith(
        "skin-123",
        expect.objectContaining({ uuid: "skin-123" })
      );
    });

    it("reconciles with the prop when the parent rolls a rejected toggle back", async () => {
      const user = userEvent.setup();
      const onWishlistToggle = vi.fn();

      const { container, rerender } = render(
        <StoreCard
          item={mockStoreItem}
          isWishlisted={false}
          onWishlistToggle={onWishlistToggle}
        />
      );

      const card = within(container);
      await user.click(card.getByRole("button", { name: /add to wishlist/i }));
      expect(card.getByRole("button", { name: /remove from wishlist/i })).toBeTruthy();

      // Parent applies its own optimistic update
      rerender(
        <StoreCard
          item={mockStoreItem}
          isWishlisted={true}
          onWishlistToggle={onWishlistToggle}
        />
      );

      // Server rejected it — parent rolls back to the real state
      rerender(
        <StoreCard
          item={mockStoreItem}
          isWishlisted={false}
          onWishlistToggle={onWishlistToggle}
        />
      );

      expect(card.getByRole("button", { name: /add to wishlist/i })).toBeTruthy();
    });
  });

  // End-to-end over the real tree (useWishlist -> StoreGrid -> StoreCard).
  // The two halves of the fix only produce the user-visible behaviour together:
  // the hook must actually roll the rejected toggle back, and the card must stop
  // pinning its optimistic override. Each half alone leaves the heart lying.
  describe("Server rejection reverts the heart (integration with useWishlist)", () => {
    function WishlistHarness({ initialUuids }: { initialUuids: string[] }) {
      const { wishlistedUuids, toggleWishlist } = useWishlist(initialUuids);
      return (
        <StoreGrid
          items={[mockStoreItem]}
          wishlistedUuids={wishlistedUuids}
          onWishlistToggle={toggleWishlist}
        />
      );
    }

    // An earlier test queues a `mockResolvedValueOnce` on fetch that it never
    // consumes, and `clearAllMocks` does not drain that queue — restore the real
    // fetch first so these tests spy on a clean one.
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("puts the heart back when the API answers 401", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      } as Response);
      const user = userEvent.setup();

      const { container } = render(<WishlistHarness initialUuids={[]} />);
      const card = within(container);

      await user.click(card.getByRole("button", { name: /add to wishlist/i }));

      expect(card.getByRole("button", { name: /add to wishlist/i })).toBeTruthy();
    });

    it("keeps the heart filled when the API accepts the toggle", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);
      const user = userEvent.setup();

      const { container } = render(<WishlistHarness initialUuids={[]} />);
      const card = within(container);

      await user.click(card.getByRole("button", { name: /add to wishlist/i }));

      expect(card.getByRole("button", { name: /remove from wishlist/i })).toBeTruthy();
    });
  });
});
