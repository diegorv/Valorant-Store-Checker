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

  describe("Toggles of one skin that overlap in flight", () => {
    function mockHeldFetches() {
      const settleFetch: Array<(res: Response) => void> = [];
      const fetches: Array<Promise<Response>> = [];
      vi.spyOn(global, "fetch").mockImplementation(() => {
        const pending = new Promise<Response>((resolve) => settleFetch.push(resolve));
        fetches.push(pending);
        return pending;
      });
      return async function settle(index: number, res: Response) {
        await act(async () => {
          settleFetch[index]!(res);
          await fetches[index];
        });
      };
    }

    function toggleWithoutWaiting(result: { current: ReturnType<typeof useWishlist> }) {
      // Each toggle runs in its own act so the next one sees the re-rendered state
      act(() => {
        void result.current.toggleWishlist("skin-123", mockStoreItem);
      });
    }

    it("leaves the skin off the wishlist when both requests are rejected", async () => {
      const settle = mockHeldFetches();
      const { result } = renderHook(() => useWishlist([]));

      toggleWithoutWaiting(result);
      toggleWithoutWaiting(result);

      await settle(0, failResponse(401, "Unauthorized"));
      await settle(1, failResponse(401, "Unauthorized"));

      expect(result.current.isWishlisted("skin-123")).toBe(false);
    });

    // Two toggles cannot tell the fix apart: the stale request's rollback target
    // equals the newer request's target. A third toggle makes them differ.
    it("does not let a stale rejection roll back what a newer accepted request set", async () => {
      const settle = mockHeldFetches();
      const { result } = renderHook(() => useWishlist([]));

      toggleWithoutWaiting(result);
      toggleWithoutWaiting(result);
      toggleWithoutWaiting(result);

      await settle(2, okResponse());
      await settle(0, failResponse(401, "Unauthorized"));
      expect(result.current.isWishlisted("skin-123")).toBe(true);

      await settle(1, failResponse(401, "Unauthorized"));
      expect(result.current.isWishlisted("skin-123")).toBe(true);
    });

    it("settles on the last toggle when two accepted responses land in reverse order", async () => {
      const settle = mockHeldFetches();
      const { result } = renderHook(() => useWishlist([]));

      toggleWithoutWaiting(result);
      toggleWithoutWaiting(result);

      await settle(1, okResponse());
      await settle(0, okResponse());

      expect(result.current.isWishlisted("skin-123")).toBe(false);
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
