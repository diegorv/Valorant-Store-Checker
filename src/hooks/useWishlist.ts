"use client";

import { useState, useCallback, useRef } from "react";
import type { StoreItem } from "@/types/store";

/**
 * Custom hook for optimistic wishlist management.
 *
 * Encapsulates the add/remove toggle with optimistic UI updates and
 * automatic rollback on API failure. Keeps the wishlist state separate
 * from any specific component, making it composable.
 *
 * @param initialUuids - Skin UUIDs currently on the user's wishlist
 */
export function useWishlist(initialUuids: string[]) {
  const [wishlistedUuids, setWishlistedUuids] = useState<string[]>(initialUuids);
  // Per skin with toggles in flight: how many, and the newest server-accepted
  // state. The item only settles once the last one lands, so a stale response
  // cannot undo what a newer request moved
  const toggleGeneration = useRef(0);
  const inFlight = useRef<
    Map<string, { pending: number; confirmed: boolean; confirmedGeneration: number }>
  >(new Map());

  const isWishlisted = useCallback(
    (uuid: string) =>
      wishlistedUuids.some(
        (id) => id.toLowerCase() === uuid.toLowerCase(),
      ),
    [wishlistedUuids],
  );

  const toggleWishlist = useCallback(
    async (skinUuid: string, item: StoreItem) => {
      const key = skinUuid.toLowerCase();
      const wasWishlisted = wishlistedUuids.some((id) => id.toLowerCase() === key);

      const generation = ++toggleGeneration.current;
      const entry = inFlight.current.get(key) ?? {
        pending: 0,
        confirmed: wasWishlisted,
        confirmedGeneration: 0,
      };
      entry.pending += 1;
      inFlight.current.set(key, entry);

      // Optimistic update
      setWishlistedUuids((prev) =>
        wasWishlisted
          ? prev.filter((id) => id.toLowerCase() !== key)
          : [...prev, skinUuid],
      );

      let accepted = false;
      try {
        const response = wasWishlisted
          ? await fetch("/api/wishlist", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ skinUuid }),
            })
          : await fetch("/api/wishlist", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                skinUuid: item.uuid,
                displayName: item.displayName,
                displayIcon: item.displayIcon,
                tierColor: item.tierColor,
                addedAt: new Date().toISOString(),
              }),
            });

        if (!response.ok) {
          throw new Error(`Failed to toggle wishlist: ${response.statusText}`);
        }
        accepted = true;
      } catch (err) {
        console.error("Wishlist toggle error:", err);
      }

      if (accepted && generation > entry.confirmedGeneration) {
        entry.confirmed = !wasWishlisted;
        entry.confirmedGeneration = generation;
      }
      entry.pending -= 1;
      if (entry.pending > 0) return;
      inFlight.current.delete(key);

      // Settle only this item on the newest accepted state (the pre-toggle
      // state if every request was rejected), preserving every other toggle
      setWishlistedUuids((prev) => {
        const without = prev.filter((id) => id.toLowerCase() !== key);
        if (!entry.confirmed) return without;
        return without.length === prev.length ? [...prev, skinUuid] : prev;
      });
    },
    [wishlistedUuids],
  );

  return { wishlistedUuids, isWishlisted, toggleWishlist };
}
