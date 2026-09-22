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
 * Sends the rotations of every account not yet imported, one account at a
 * time and in batches of IMPORT_BATCH_SIZE. Returns the accounts that are now
 * fully imported, for the caller to remember so they are not sent again.
 *
 * An account is left out when the server skipped it (not linked in this
 * browser yet) or when one of its batches failed, so a later visit retries
 * it — and one account's failure never holds back the others.
 */
export async function importLegacyRotations(
  rotations: StoreRotation[],
  alreadyImported: ReadonlySet<string>,
  post: (batch: Omit<StoreRotation, "id">[]) => Promise<ImportResponse | null>
): Promise<string[]> {
  const byAccount = new Map<string, Omit<StoreRotation, "id">[]>();
  for (const { id: _id, ...rotation } of rotations) {
    if (alreadyImported.has(rotation.puuid)) continue;
    const pending = byAccount.get(rotation.puuid) ?? [];
    pending.push(rotation);
    byAccount.set(rotation.puuid, pending);
  }

  const imported: string[] = [];
  for (const [puuid, pending] of byAccount) {
    let accepted = true;
    for (let i = 0; i < pending.length && accepted; i += IMPORT_BATCH_SIZE) {
      const response = await post(pending.slice(i, i + IMPORT_BATCH_SIZE));
      accepted = response !== null && !response.skippedPuuids.includes(puuid);
    }
    if (accepted) imported.push(puuid);
  }

  return imported;
}
