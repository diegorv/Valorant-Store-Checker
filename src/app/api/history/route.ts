/**
 * Store History API Route
 *
 * GET    /api/history          rotations for every account in the session's registry, newest first
 * DELETE /api/history {id}     remove one rotation (must belong to one of those accounts)
 * POST   /api/history {rotations} import rotations a browser logged before history moved server-side
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withSession, parseBody } from "@/lib/api-validate";
import { getAccounts } from "@/lib/accounts";
import { getStoreRotations, deleteStoreRotation, importStoreRotations } from "@/lib/store-history-db";
import { createLogger } from "@/lib/logger";
import type { SessionData } from "@/lib/schemas/session";

const HISTORY_LIMIT = 365;
const IMPORT_LIMIT = 1000;

const HistoryItemSchema = z.object({
  uuid: z.string(),
  displayName: z.string(),
  cost: z.number(),
  tierName: z.string().nullable(),
  tierColor: z.string(),
});

const RotationSchema = z.object({
  puuid: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timestamp: z.number(),
  expiresAt: z.number(),
  gameName: z.string().optional(),
  tagLine: z.string().optional(),
  items: z.array(HistoryItemSchema).min(1),
});

const ImportSchema = z.object({ rotations: z.array(RotationSchema).max(IMPORT_LIMIT) });
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
    return NextResponse.json({ error: "Failed to load history", code: "UNKNOWN" }, { status: 500 });
  }
});

export const DELETE = withSession(async (request, session, reqId?: string) => {
  const log = createLogger("History API", reqId);
  const parsed = await parseBody(request, DeleteSchema);
  if (!parsed.success) return parsed.response;
  try {
    const deleted = await deleteStoreRotation(await allowedPuuids(session), parsed.data.id);
    if (!deleted) return NextResponse.json({ error: "Rotation not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Failed to delete rotation:", error);
    return NextResponse.json({ error: "Failed to delete rotation", code: "UNKNOWN" }, { status: 500 });
  }
});

export const POST = withSession(async (request, session, reqId?: string) => {
  const log = createLogger("History API", reqId);
  const parsed = await parseBody(request, ImportSchema);
  if (!parsed.success) return parsed.response;
  try {
    const allowed = new Set(await allowedPuuids(session));
    const accepted = parsed.data.rotations.filter((r) => allowed.has(r.puuid));
    const imported = await importStoreRotations(accepted);
    return NextResponse.json({ imported, skipped: parsed.data.rotations.length - accepted.length });
  } catch (error) {
    log.error("Failed to import history:", error);
    return NextResponse.json({ error: "Failed to import history", code: "UNKNOWN" }, { status: 500 });
  }
});
