import { DailyStoreClient } from "@/components/store/DailyStoreClient";
import { checkWishlistInStore } from "@/lib/wishlist";
import { recordStoreRotation } from "@/lib/store-history-db";
import { StoreTokens } from "@/lib/riot-store";
import { getActiveAccount } from "@/lib/accounts";
import { createLogger } from "@/lib/logger";
import type { StoreData } from "@/types/store";

const log = createLogger("daily-store");

interface DailyStoreSectionProps {
  session: StoreTokens;
  storeData: StoreData;
}

export async function DailyStoreSection({ session, storeData }: DailyStoreSectionProps) {
  const { items, expiresAt } = storeData;

  const activeAccount = await getActiveAccount();

  // Wishlist matches and today's history row, side by side. History is a
  // best-effort write: a database hiccup must never keep the store from rendering.
  const [wishlistMatches] = await Promise.all([
    checkWishlistInStore(session.puuid, items.map((i) => i.uuid)),
    recordStoreRotation(
      session.puuid,
      items,
      expiresAt,
      activeAccount ? { gameName: activeAccount.gameName, tagLine: activeAccount.tagLine } : undefined,
    ).catch((error) => log.warn("Failed to record store rotation:", error)),
  ]);
  const wishlistedUuids = wishlistMatches
    .filter((m) => m.isInStore)
    .map((m) => m.skinUuid);

  return (
    <div className="mb-8">
      <DailyStoreClient
        items={items}
        initialWishlistedUuids={wishlistedUuids}
        expiresAt={expiresAt.toISOString()}
      />
    </div>
  );
}
