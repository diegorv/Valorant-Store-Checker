/**
 * Legacy history import — decides what a browser's IndexedDB log still has to
 * send to POST /api/history. Pure, so the history page and tests share it.
 */

import type { StoreRotation } from "@/types/history";

/** Most rotations POST /api/history accepts in one request. */
export const IMPORT_BATCH_SIZE = 1000;

export interface ImportResponse {
  /** Accounts the server refused because they are not in this browser's registry. */
  skippedPuuids: string[];
}

/**
 * Sends the rotations of every account not yet imported, in batches.
 * Returns the accounts now fully imported (to remember, so they are not sent
 * again), or null when a batch failed and nothing should be remembered.
 * Accounts the server skipped are left out so a later visit, once they are
 * linked, retries them.
 */
export async function importLegacyRotations(
  rotations: StoreRotation[],
  alreadyImported: ReadonlySet<string>,
  post: (batch: Omit<StoreRotation, "id">[]) => Promise<ImportResponse | null>
): Promise<string[] | null> {
  const pending = rotations
    .filter((r) => !alreadyImported.has(r.puuid))
    .map(({ id: _id, ...rotation }) => rotation);

  const skipped = new Set<string>();
  for (let i = 0; i < pending.length; i += IMPORT_BATCH_SIZE) {
    const response = await post(pending.slice(i, i + IMPORT_BATCH_SIZE));
    if (!response) return null;
    for (const puuid of response.skippedPuuids) skipped.add(puuid);
  }

  return [...new Set(pending.map((r) => r.puuid))].filter((puuid) => !skipped.has(puuid));
}
