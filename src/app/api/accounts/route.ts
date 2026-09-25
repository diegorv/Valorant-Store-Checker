/**
 * Accounts Management API Route
 *
 * Endpoints:
 * - GET /api/accounts - List all stored accounts
 * - DELETE /api/accounts?puuid=xxx - Remove a specific account
 *
 * Security:
 * - Requires a valid session (withSession)
 * - Uses account registry from cookies
 * - Automatically handles account switching when removing active account
 */

import { NextResponse } from "next/server";
import { withSession } from "@/lib/api-validate";
import { errorResponse, notFoundResponse, serverErrorResponse } from "@/lib/api-error";
import { getAccounts, removeAccount } from "@/lib/accounts";
import { createLogger } from "@/lib/logger";

/**
 * GET /api/accounts
 * Returns list of stored accounts and which one is active
 */
export const GET = withSession(async (_request, _session, reqId?: string) => {
  const log = createLogger("Accounts API", reqId);
  try {
    const registry = await getAccounts();

    // A session that predates the registry lists nothing. Building the
    // registry here would revoke and reissue the caller's session on a read,
    // signing out every request still in flight with the old cookie; the login
    // path registers it instead (migrateSessionToRegistry).
    if (!registry) {
      return NextResponse.json({
        accounts: [],
      });
    }

    // Transform to include isActive flag
    const accounts = registry.accounts.map((account) => ({
      puuid: account.puuid,
      region: account.region,
      gameName: account.gameName,
      tagLine: account.tagLine,
      isActive: account.puuid === registry.activePuuid,
      addedAt: account.addedAt,
    }));

    return NextResponse.json({
      accounts,
    });
  } catch (error) {
    log.error("Failed to get accounts:", error);
    return serverErrorResponse("Failed to retrieve accounts");
  }
});

/**
 * DELETE /api/accounts?puuid=xxx
 * Removes a specific account by PUUID
 */
export const DELETE = withSession(async (request, _session, reqId?: string) => {
  const log = createLogger("Accounts API", reqId);
  try {
    const { searchParams } = new URL(request.url);
    const puuid = searchParams.get("puuid");

    if (!puuid) {
      return errorResponse("PUUID is required", "VALIDATION_ERROR");
    }

    // Remove account (handles active account switching automatically)
    const removed = await removeAccount(puuid);

    if (!removed) {
      return notFoundResponse("Account");
    }

    log.info(`Removed account ${puuid.substring(0, 8)}`);

    return NextResponse.json({
      success: true,
      message: "Account removed successfully",
    });
  } catch (error) {
    log.error("Failed to remove account:", error);
    return serverErrorResponse("Failed to remove account");
  }
});
