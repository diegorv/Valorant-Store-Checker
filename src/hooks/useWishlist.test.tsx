import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useWishlist } from "./useWishlist";
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

const itemWith = (uuid: string): StoreItem => ({ ...mockStoreItem, uuid });

const okResponse = () => ({ ok: true, status: 200, statusText: "OK" } as Response);
const failResponse = (status: number, statusText: string) =>
  ({ ok: false, status, statusText } as Response);

describe("useWishlist", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Server rejection rolls the optimistic update back", () => {
    it("reverts the add when the API answers 401", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(failResponse(401, "Unauthorized"));

      const { result } = renderHook(() => useWishlist([]));

      await act(async () => {
        await result.current.toggleWishlist("skin-123", mockStoreItem);
      });

      expect(result.current.wishlistedUuids).toEqual([]);
      expect(result.current.isWishlisted("skin-123")).toBe(false);
    });

    it("reverts the removal when the API answers 500", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(failResponse(500, "Internal Server Error"));

      const { result } = renderHook(() => useWishlist(["skin-123"]));

      await act(async () => {
        await result.current.toggleWishlist("skin-123", mockStoreItem);
      });

      expect(result.current.isWishlisted("skin-123")).toBe(true);
    });

    it("reverts the add when the API answers 400 (wishlist full)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(failResponse(400, "Bad Request"));

      const { result } = renderHook(() => useWishlist([]));

      await act(async () => {
        await result.current.toggleWishlist("skin-123", mockStoreItem);
      });

      expect(result.current.wishlistedUuids).toEqual([]);
    });
  });

  describe("Rollback is scoped to the rejected item", () => {
    it("preserves toggles that succeeded since the page loaded", async () => {
      const fetchMock = vi.spyOn(global, "fetch");
      fetchMock.mockResolvedValueOnce(okResponse());
      fetchMock.mockResolvedValueOnce(failResponse(401, "Unauthorized"));

      const { result } = renderHook(() => useWishlist([]));

      await act(async () => {
        await result.current.toggleWishlist("skin-aaa", itemWith("skin-aaa"));
      });
      expect(result.current.wishlistedUuids).toEqual(["skin-aaa"]);

      await act(async () => {
        await result.current.toggleWishlist("skin-bbb", itemWith("skin-bbb"));
      });

      expect(result.current.wishlistedUuids).toEqual(["skin-aaa"]);
    });

    it("preserves a removal that succeeded when a later add is rejected", async () => {
      const fetchMock = vi.spyOn(global, "fetch");
      fetchMock.mockResolvedValueOnce(okResponse());
      fetchMock.mockResolvedValueOnce(failResponse(500, "Internal Server Error"));

      const { result } = renderHook(() => useWishlist(["skin-aaa"]));

      await act(async () => {
        await result.current.toggleWishlist("skin-aaa", itemWith("skin-aaa"));
      });
      expect(result.current.wishlistedUuids).toEqual([]);

      await act(async () => {
        await result.current.toggleWishlist("skin-bbb", itemWith("skin-bbb"));
      });

      expect(result.current.wishlistedUuids).toEqual([]);
    });
  });

  // Requests for one skin run one at a time: a toggle made while another is in
  // flight starts its request only once that one settles
  describe("Toggles of one skin made while a request is in flight", () => {
    function mockHeldFetches() {
      const settleFetch: Array<(res: Response) => void> = [];
      const methods: string[] = [];
      vi.spyOn(global, "fetch").mockImplementation((_input, init) => {
        methods.push(init?.method ?? "GET");
        return new Promise<Response>((resolve) => settleFetch.push(resolve));
      });
      async function settle(index: number, res: Response) {
        await act(async () => {
          settleFetch[index]!(res);
          // Let the settled request finish and the next queued one start
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
      return { settle, methods };
    }

    async function toggleWithoutWaiting(
      result: { current: ReturnType<typeof useWishlist> },
      uuid = "skin-123",
    ) {
      // Each toggle runs in its own act so the next one sees the re-rendered state
      await act(async () => {
        void result.current.toggleWishlist(uuid, itemWith(uuid));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    it("sends the second request only after the first settles, and both rejected leave the skin off", async () => {
      const { settle, methods } = mockHeldFetches();
      const { result } = renderHook(() => useWishlist([]));

      await toggleWithoutWaiting(result);
      await toggleWithoutWaiting(result);

      // The second toggle waits: one request in flight, state still the first toggle's
      expect(methods).toEqual(["POST"]);
      expect(result.current.isWishlisted("skin-123")).toBe(true);

      await settle(0, failResponse(401, "Unauthorized"));
      expect(methods).toHaveLength(2);

      await settle(1, failResponse(401, "Unauthorized"));
      expect(result.current.isWishlisted("skin-123")).toBe(false);
    });

    it("sends the second toggle as a removal once the first add is accepted", async () => {
      const { settle, methods } = mockHeldFetches();
      const { result } = renderHook(() => useWishlist([]));

      await toggleWithoutWaiting(result);
      await toggleWithoutWaiting(result);

      await settle(0, okResponse());
      expect(methods).toEqual(["POST", "DELETE"]);

      await settle(1, okResponse());
      expect(result.current.isWishlisted("skin-123")).toBe(false);
    });

    it("ends on after three accepted toggles", async () => {
      const { settle, methods } = mockHeldFetches();
      const { result } = renderHook(() => useWishlist([]));

      await toggleWithoutWaiting(result);
      await toggleWithoutWaiting(result);
      await toggleWithoutWaiting(result);

      await settle(0, okResponse());
      await settle(1, okResponse());
      await settle(2, okResponse());

      expect(methods).toEqual(["POST", "DELETE", "POST"]);
      expect(result.current.isWishlisted("skin-123")).toBe(true);
    });

    // The direction is read when the request starts, not when the toggle was made
    it("re-sends the second toggle as an add when the first add is rejected", async () => {
      const { settle, methods } = mockHeldFetches();
      const { result } = renderHook(() => useWishlist([]));

      await toggleWithoutWaiting(result);
      await toggleWithoutWaiting(result);

      await settle(0, failResponse(401, "Unauthorized"));
      expect(methods).toEqual(["POST", "POST"]);

      await settle(1, okResponse());
      expect(result.current.isWishlisted("skin-123")).toBe(true);
    });

    it("does not hold one skin's request behind another skin's", async () => {
      const { methods } = mockHeldFetches();
      const { result } = renderHook(() => useWishlist([]));

      await toggleWithoutWaiting(result, "skin-aaa");
      await toggleWithoutWaiting(result, "skin-bbb");

      expect(methods).toEqual(["POST", "POST"]);
    });
  });

  describe("UUID comparison is case-insensitive", () => {
    it("removes an entry stored with different casing", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(okResponse());

      const { result } = renderHook(() => useWishlist(["ABC-123"]));

      await act(async () => {
        await result.current.toggleWishlist("abc-123", itemWith("abc-123"));
      });

      expect(result.current.wishlistedUuids).toEqual([]);
      expect(result.current.isWishlisted("ABC-123")).toBe(false);
    });

    it("rolls a rejected removal back without duplicating the entry", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(failResponse(401, "Unauthorized"));

      const { result } = renderHook(() => useWishlist(["ABC-123"]));

      await act(async () => {
        await result.current.toggleWishlist("abc-123", itemWith("abc-123"));
      });

      expect(result.current.wishlistedUuids).toHaveLength(1);
      expect(result.current.isWishlisted("ABC-123")).toBe(true);
    });
  });
});
