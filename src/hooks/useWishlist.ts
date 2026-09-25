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
  // Written together with the state, so a queued toggle reads what the
  // previous request left rather than a render's closure
  const currentUuids = useRef(initialUuids);
  // Requests for one skin run one at a time, so the server commits them in
  // click order and each rollback restores the state its own request started from
  const toggleChains = useRef<Map<string, Promise<void>>>(new Map());

  const isWishlisted = useCallback(
    (uuid: string) =>
      wishlistedUuids.some(
        (id) => id.toLowerCase() === uuid.toLowerCase(),
      ),
    [wishlistedUuids],
  );

  const toggleWishlist = useCallback(
    (skinUuid: string, item: StoreItem) => {
      const key = skinUuid.toLowerCase();

      const performToggle = async () => {
        // Direction is decided when the request starts: a toggle made while an
        // earlier one was in flight flips whatever state that one left
        const wasWishlisted = currentUuids.current.some((id) => id.toLowerCase() === key);

        // Optimistic update
        currentUuids.current = wasWishlisted
          ? currentUuids.current.filter((id) => id.toLowerCase() !== key)
          : [...currentUuids.current, skinUuid];
        setWishlistedUuids(currentUuids.current);

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
        } catch (err) {
          console.error("Wishlist toggle error:", err);
          // Rollback only this item, preserving every other successful toggle
          const without = currentUuids.current.filter((id) => id.toLowerCase() !== key);
          currentUuids.current = wasWishlisted ? [...without, skinUuid] : without;
          setWishlistedUuids(currentUuids.current);
        }
      };

      // A toggle made while this skin's request is in flight shows no change,
      // here or on the card, until the previous request settles. With none in
      // flight it starts right away, so the optimistic update lands inside the
      // click handler
      const previous = toggleChains.current.get(key);
      const run = previous ? previous.then(performToggle) : performToggle();
      toggleChains.current.set(key, run);
      void run.finally(() => {
        if (toggleChains.current.get(key) === run) toggleChains.current.delete(key);
      });
      return run;
    },
    [],
  );

  return { wishlistedUuids, isWishlisted, toggleWishlist };
}
