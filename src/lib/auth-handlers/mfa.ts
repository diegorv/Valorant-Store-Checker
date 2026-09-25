/**
 * MFA Auth Handler
 *
 * Handles MFA code submission flow.
 * Submits a one-time code to complete multi-factor authentication.
 */

import { NextResponse } from "next/server";
import { submitMfa } from "@/lib/riot-auth";
import { errorResponse } from "@/lib/api-error";
import { registerAuthenticatedSession } from "./shared";
import type { AuthBody } from "./shared";

export async function handleMfaAuth(
  body: Extract<AuthBody, { type: "multifactor" }>,
): Promise<NextResponse> {
  const result = await submitMfa(body.code, body.cookie);

  if (!result.success) {
    // Riot re-issued the challenge: let the caller prompt for another code
    // instead of reporting a failure, same as the credentials handler.
    if ("type" in result) {
      return NextResponse.json({
        success: false,
        requiresMfa: true,
        cookie: result.cookie,
        multifactor: result.multifactor,
        // Set when Riot re-issued the challenge because it refused the last
        // code; dropped from the JSON when Riot gave no reason.
        error: result.error,
      });
    }

    return errorResponse(result.error || "MFA verification failed", "UNAUTHORIZED", undefined, 401);
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
