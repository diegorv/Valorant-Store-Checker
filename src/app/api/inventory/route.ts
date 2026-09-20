/**
 * Inventory API Route
 *
 * Protected endpoint that returns the user's owned weapon skins collection.
 * Fetches entitlements from Riot PD API and hydrates with Valorant-API data.
 *
 * Query parameters:
 * - `refresh=true`  drop the caches and fetch from Riot again
 * - `catalog=true`  also return the skins the user does NOT own
 *   (`unownedSkins`, roughly the whole catalog) — the collection page asks
 *   for it, callers that only need the owned set (wishlist) do not pay for it
 */

import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/lib/api-validate";
import { getOwnedSkins, clearInventoryCache } from "@/lib/riot-inventory";
import { getCachedInventory, clearCachedInventory } from "@/lib/inventory-cache";
import { createLogger } from "@/lib/logger";
import type { InventoryData } from "@/types/inventory";

/** Strips the catalog side unless the caller asked for it. */
function shapeResponse(data: InventoryData, includeCatalog: boolean): InventoryData {
  return includeCatalog ? data : { ...data, unownedSkins: [] };
}

export const GET = withSession(async (request: NextRequest, session, reqId?: string) => {
  const log = createLogger("Inventory API", reqId);
  try {
    // If ?refresh=true, clear all caches to force a fresh fetch from Riot and Valorant-API
    const refresh = request.nextUrl.searchParams.get("refresh") === "true";
    if (refresh) {
      clearInventoryCache(session.puuid);
      clearCachedInventory(session.puuid);
      // Note: Valorant-API static skin data is NOT cleared here — purchasing a skin
      // only changes *your entitlements*, not the global skin definitions list.
      log.info(`Inventory caches cleared for PUUID: ${session.puuid.substring(0, 8)} (manual refresh)`);
    }
    const includeCatalog = request.nextUrl.searchParams.get("catalog") === "true";

    // Fetch owned skins
    try {
      const inventoryData = await getOwnedSkins(session);

      return NextResponse.json(
        { ...shapeResponse(inventoryData, includeCatalog), fromCache: false },
        {
          headers: {
            "Cache-Control": "private, max-age=60, stale-while-revalidate=240",
          },
        }
      );
    } catch (fetchError) {
      log.warn("Inventory fetch failed:", fetchError);

      // Fall back to cache
      const cached = getCachedInventory(session.puuid);
      if (cached) {
        log.info("Serving cached inventory data");
        return NextResponse.json(
          { ...shapeResponse(cached, includeCatalog), fromCache: true },
          {
            headers: {
              "Cache-Control": "private, max-age=60, stale-while-revalidate=240",
            },
          }
        );
      }

      // The upstream error stays in the server log above — the client only needs
      // the generic message, and echoing the raw Riot response leaks its shape.
      return NextResponse.json(
        {
          error: "Failed to fetch inventory data",
          code: "RIOT_API_ERROR",
        },
        { status: 500 }
      );
    }
  } catch (error) {
    log.error("Unhandled error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch inventory data",
        code: "UNKNOWN",
      },
      { status: 500 }
    );
  }
}, { refresh: true });
