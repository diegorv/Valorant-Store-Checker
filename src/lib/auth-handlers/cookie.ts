/**
 * Cookie Auth Handler
 *
 * Handles "paste cookies" authentication flow.
 * Refreshes tokens using raw Riot cookie string.
 *
 * Rate limiting is applied once, by the caller (POST /api/auth).
 */

import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { registerAuthenticatedSession } from "./shared";
import type { AuthBody } from "./shared";

export async function handleCookieAuth(
  body: Extract<AuthBody, { type: "cookie" }>,
): Promise<NextResponse> {
  const { refreshTokensWithCookies } = await import("@/lib/riot-reauth");
  const result = await refreshTokensWithCookies(body.cookie);

  if (!result.success) {
    return errorResponse(result.error || "Failed to authenticate with cookies", "UNAUTHORIZED", undefined, 401);
  }

  await registerAuthenticatedSession(result.tokens, result.riotCookies ?? "");

  return NextResponse.json({
    success: true,
    data: {
      puuid: result.tokens.puuid,
      region: result.tokens.region,
    },
  });
}
