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

  // The toggle requests are held open so a heart can be clicked again before the
  // first round-trip ends. Requests for one skin run one at a time, so the second
  // click's request only starts once the first one settles.
  describe("Hearts clicked again before the first request settles", () => {
    function mockHeldToggles() {
      const settleToggle: Array<(res: Response) => void> = [];
      const methods: string[] = [];

      vi.spyOn(global, "fetch").mockImplementation(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (!init?.method) {
            return { ok: true, json: async () => ({ items: [] }) } as Response;
          }
          methods.push(init.method);
          return new Promise<Response>((resolve) => settleToggle.push(resolve));
        }
      );

      async function settle(index: number, res: Partial<Response>) {
        await act(async () => {
          settleToggle[index]!(res as Response);
          // Let the settled request finish and the next queued one start
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }

      return { settle, methods };
    }

    const rejected = { ok: false, status: 401, statusText: "Unauthorized" };
    const accepted = { ok: true, status: 200, statusText: "OK" };

    async function renderHearts() {
      const page = within(
        render(
          <EncyclopediaClient skins={[primeVandal, rebornPhantom]} tiers={[]} tierMap={new Map()} />
        ).container
      );
      const vandal = within(page.getByRole("article", { name: /Prime Vandal/ }));
      const phantom = within(page.getByRole("article", { name: /Reaver Phantom/ }));
      // Let the mount GET land so it cannot interleave with the toggles
      await act(async () => {});
      return { vandal, phantom };
    }

    it("sends the second request only after the first settles, and both rejected leave the skin off", async () => {
      const { settle, methods } = mockHeldToggles();
      const user = userEvent.setup();
      const { vandal } = await renderHearts();

      await user.click(vandal.getByRole("button", { name: /add to wishlist/i }));
      await user.click(vandal.getByRole("button", { name: /remove from wishlist/i }));

      // The second click waits: one request in flight, heart still on the first click's state
      expect(methods).toEqual(["POST"]);
      expect(vandal.getByRole("button", { name: /remove from wishlist/i })).toBeTruthy();

      await settle(0, rejected);
      expect(methods).toHaveLength(2);

      await settle(1, rejected);
      expect(vandal.getByRole("button", { name: /add to wishlist/i })).toBeTruthy();
    });

    it("sends the second toggle as a removal once the first add is accepted", async () => {
      const { settle, methods } = mockHeldToggles();
      const user = userEvent.setup();
      const { vandal } = await renderHearts();

      await user.click(vandal.getByRole("button", { name: /add to wishlist/i }));
      await user.click(vandal.getByRole("button", { name: /remove from wishlist/i }));

      await settle(0, accepted);
      expect(methods).toEqual(["POST", "DELETE"]);

      await settle(1, accepted);
      expect(vandal.getByRole("button", { name: /add to wishlist/i })).toBeTruthy();
    });

    it("ends on after three accepted toggles", async () => {
      const { settle, methods } = mockHeldToggles();
      const user = userEvent.setup();
      const { vandal } = await renderHearts();

      await user.click(vandal.getByRole("button", { name: /add to wishlist/i }));
      await user.click(vandal.getByRole("button", { name: /remove from wishlist/i }));
      await user.click(vandal.getByRole("button", { name: /remove from wishlist/i }));

      await settle(0, accepted);
      await settle(1, accepted);
      await settle(2, accepted);

      expect(methods).toEqual(["POST", "DELETE", "POST"]);
      expect(vandal.getByRole("button", { name: /remove from wishlist/i })).toBeTruthy();
    });

    // The direction is read when the request starts, not when the heart was clicked
    it("re-sends the second toggle as an add when the first add is rejected", async () => {
      const { settle, methods } = mockHeldToggles();
      const user = userEvent.setup();
      const { vandal } = await renderHearts();

      await user.click(vandal.getByRole("button", { name: /add to wishlist/i }));
      await user.click(vandal.getByRole("button", { name: /remove from wishlist/i }));

      await settle(0, rejected);
      expect(methods).toEqual(["POST", "POST"]);

      await settle(1, accepted);
      expect(vandal.getByRole("button", { name: /remove from wishlist/i })).toBeTruthy();
    });

    it("does not hold one skin's request behind another skin's", async () => {
      const { methods } = mockHeldToggles();
      const user = userEvent.setup();
      const { vandal, phantom } = await renderHearts();

      await user.click(vandal.getByRole("button", { name: /add to wishlist/i }));
      await user.click(phantom.getByRole("button", { name: /add to wishlist/i }));

      expect(methods).toEqual(["POST", "POST"]);
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
