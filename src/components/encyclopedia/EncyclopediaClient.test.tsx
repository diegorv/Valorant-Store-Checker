import { describe, it, expect, vi, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EncyclopediaClient } from "./EncyclopediaClient";
import type { EncyclopediaSkin } from "@/types/encyclopedia";
import type { WishlistItem } from "@/types/wishlist";

const primeVandal: EncyclopediaSkin = {
  uuid: "skin-123",
  displayName: "Prime Vandal",
  displayIcon: "/images/prime-vandal.png",
  wallpaper: null,
  weaponName: "Vandal",
  tierName: "Select Edition",
  tierColor: "#5A9FE2",
  contentTierUuid: null,
};

const rebornPhantom: EncyclopediaSkin = {
  uuid: "skin-456",
  displayName: "Reaver Phantom",
  displayIcon: "/images/reaver-phantom.png",
  wallpaper: null,
  weaponName: "Phantom",
  tierName: "Premium Edition",
  tierColor: "#D1548D",
  contentTierUuid: null,
};

function wishlistItem(skinUuid: string): WishlistItem {
  return {
    skinUuid,
    displayName: "",
    displayIcon: "",
    tierColor: "",
    addedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("EncyclopediaClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The mount GET is held open so a heart can be toggled while it is in flight.
  // Its payload then predates the click, exactly like a slow first load.
  describe("A heart toggled while the first wishlist fetch is in flight", () => {
    function mockSlowWishlistApi(toggleResponse: Partial<Response>) {
      let resolveMount!: (items: WishlistItem[]) => void;
      const mountFetch = new Promise<Response>((resolve) => {
        resolveMount = (items) =>
          resolve({ ok: true, json: async () => ({ items }) } as Response);
      });

      vi.spyOn(global, "fetch").mockImplementation(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          // The mount fetch has no method; the toggle fetch is POST/DELETE
          init?.method ? (toggleResponse as Response) : mountFetch
      );

      return async function settleMount(items: WishlistItem[]) {
        await act(async () => {
          resolveMount(items);
          await mountFetch;
        });
      };
    }

    function renderEncyclopedia() {
      return within(
        render(
          <EncyclopediaClient
            skins={[primeVandal, rebornPhantom]}
            tiers={[]}
            tierMap={new Map()}
          />
        ).container
      );
    }

    it("survives the fetch landing, and the fetched wishlist still applies", async () => {
      const settleMount = mockSlowWishlistApi({ ok: true, status: 200, statusText: "OK" });
      const user = userEvent.setup();

      const page = renderEncyclopedia();
      const vandal = within(page.getByRole("article", { name: /Prime Vandal/ }));
      const phantom = within(page.getByRole("article", { name: /Reaver Phantom/ }));

      await user.click(vandal.getByRole("button", { name: /add to wishlist/i }));

      // The GET lands with a list that predates the click
      await settleMount([wishlistItem(rebornPhantom.uuid)]);

      const vandalHeart = vandal.getByRole("button", { name: /remove from wishlist/i });
      expect(vandalHeart.querySelector("svg")?.getAttribute("class")).toContain("fill-brand");
      expect(phantom.getByRole("button", { name: /remove from wishlist/i })).toBeTruthy();
    });

    it("stays empty when the server rejected it, even if the fetch lands afterwards", async () => {
      const settleMount = mockSlowWishlistApi({ ok: false, status: 401, statusText: "Unauthorized" });
      const user = userEvent.setup();

      const page = renderEncyclopedia();
      const vandal = within(page.getByRole("article", { name: /Prime Vandal/ }));

      await user.click(vandal.getByRole("button", { name: /add to wishlist/i }));

      await settleMount([]);

      const vandalHeart = vandal.getByRole("button", { name: /add to wishlist/i });
      expect(vandalHeart.querySelector("svg")?.getAttribute("class")).toContain("fill-none");
    });

    it("follows the fetched wishlist when the server rejected it and already had the skin", async () => {
      const settleMount = mockSlowWishlistApi({ ok: false, status: 401, statusText: "Unauthorized" });
      const user = userEvent.setup();

      const page = renderEncyclopedia();
      const vandal = within(page.getByRole("article", { name: /Prime Vandal/ }));

      await user.click(vandal.getByRole("button", { name: /add to wishlist/i }));

      // The GET lands holding the very skin whose toggle was just rejected
      await settleMount([wishlistItem(primeVandal.uuid)]);

      const vandalHeart = vandal.getByRole("button", { name: /remove from wishlist/i });
      expect(vandalHeart.querySelector("svg")?.getAttribute("class")).toContain("fill-brand");
    });
  });

  // In development the page runs under Strict Mode, so the mount effect fires
  // twice and the second payload lands after the first one already has.
  describe("A heart toggled between Strict Mode's two mount fetches", () => {
    it("survives the second payload landing", async () => {
      const resolveMount: Array<(res: Response) => void> = [];
      const mountFetches: Array<Promise<Response>> = [];

      vi.spyOn(global, "fetch").mockImplementation(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method) return { ok: true, status: 200 } as Response;
          const mountFetch = new Promise<Response>((resolve) => resolveMount.push(resolve));
          mountFetches.push(mountFetch);
          return mountFetch;
        }
      );

      async function settleMount(index: number, items: WishlistItem[]) {
        await act(async () => {
          resolveMount[index]!({ ok: true, json: async () => ({ items }) } as Response);
          await mountFetches[index];
        });
      }

      const user = userEvent.setup();
      const page = within(
        render(
          <StrictMode>
            <EncyclopediaClient skins={[primeVandal]} tiers={[]} tierMap={new Map()} />
          </StrictMode>
        ).container
      );
      expect(resolveMount).toHaveLength(2);

      await settleMount(0, []);

      const vandal = within(page.getByRole("article", { name: /Prime Vandal/ }));
      await user.click(vandal.getByRole("button", { name: /add to wishlist/i }));

      // The second GET still carries the list that predates the click
      await settleMount(1, []);

      expect(vandal.getByRole("button", { name: /remove from wishlist/i })).toBeTruthy();
    });
  });
});
