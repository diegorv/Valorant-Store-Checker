/**
 * Store History API Route
 *
 * GET    /api/history          rotations for every account in the session's registry, newest first
 * DELETE /api/history {id}     remove one rotation (must belong to one of those accounts)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withSession, parseBody } from "@/lib/api-validate";
import { notFoundResponse, serverErrorResponse } from "@/lib/api-error";
import { getAccounts } from "@/lib/accounts";
import { getStoreRotations, deleteStoreRotation } from "@/lib/store-history-db";
import { createLogger } from "@/lib/logger";
import type { SessionData } from "@/lib/schemas/session";

const HISTORY_LIMIT = 365;

const DeleteSchema = z.object({ id: z.number().int().positive() });

/** The active account plus every account linked in this browser's registry. */
async function allowedPuuids(session: SessionData): Promise<string[]> {
  const registry = await getAccounts();
  const puuids = new Set<string>([session.puuid]);
  for (const account of registry?.accounts ?? []) puuids.add(account.puuid);
  return [...puuids];
}

export const GET = withSession(async (_request, session, reqId?: string) => {
  const log = createLogger("History API", reqId);
  try {
    const rotations = await getStoreRotations(await allowedPuuids(session), HISTORY_LIMIT);
    return NextResponse.json({ rotations }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    log.error("Failed to read history:", error);
    return serverErrorResponse("Failed to load history");
  }
});

export const DELETE = withSession(async (request, session, reqId?: string) => {
  const log = createLogger("History API", reqId);
  const parsed = await parseBody(request, DeleteSchema);
  if (!parsed.success) return parsed.response;
  try {
    const deleted = await deleteStoreRotation(await allowedPuuids(session), parsed.data.id);
    if (!deleted) return notFoundResponse("Rotation");
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Failed to delete rotation:", error);
    return serverErrorResponse("Failed to delete rotation");
  }
});
