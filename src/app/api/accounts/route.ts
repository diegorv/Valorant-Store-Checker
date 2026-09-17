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
import { getAccounts, addAccount, removeAccount } from "@/lib/accounts";
import { createLogger } from "@/lib/logger";

/**
 * GET /api/accounts
 * Returns list of stored accounts and which one is active
 */
export const GET = withSession(async (_request, session, reqId?: string) => {
  const log = createLogger("Accounts API", reqId);
  try {
    let registry = await getAccounts();

    // Migration: if no registry exists yet, auto-populate it
    // from the current session
    if (!registry) {
      log.info("Migrating existing session to multi-account registry");
      await addAccount(
        {
          puuid: session.puuid,
          region: session.region,
          gameName: session.gameName,
          tagLine: session.tagLine,
          addedAt: session.createdAt || Date.now(),
        },
        {
          accessToken: session.accessToken,
          entitlementsToken: session.entitlementsToken,
          puuid: session.puuid,
          region: session.region,
          gameName: session.gameName,
          tagLine: session.tagLine,
          country: session.country,
          riotCookies: session.riotCookies,
        }
      );
      registry = await getAccounts();
    }

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
    return NextResponse.json(
      { error: "Failed to retrieve accounts" },
      { status: 500 }
    );
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
      return NextResponse.json(
        { error: "PUUID is required" },
        { status: 400 }
      );
    }

    // Remove account (handles active account switching automatically)
    const removed = await removeAccount(puuid);

    if (!removed) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      );
    }

    log.info(`Removed account ${puuid.substring(0, 8)}`);

    return NextResponse.json({
      success: true,
      message: "Account removed successfully",
    });
  } catch (error) {
    log.error("Failed to remove account:", error);
    return NextResponse.json(
      { error: "Failed to remove account" },
      { status: 500 }
    );
  }
});
