"use server";

/**
 * Auth Server Action
 *
 * Handles authentication via URL or Cookie paste. Runs server-side only —
 * credentials never pass through the client's network tab.
 *
 * Used by <LoginForm> as a progressive-enhancement alternative to
 * POST /api/auth (which still exists for external consumers).
 */

import { headers } from "next/headers";
import { completeAuthWithUrl } from "@/lib/riot-auth";
import { refreshTokensWithCookies } from "@/lib/riot-reauth";
import { registerAuthenticatedSession } from "@/lib/auth-handlers/shared";
import { createLogger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limiter";
import { getClientIP } from "@/lib/rate-limit-utils";

const log = createLogger("Auth Action");

export type AuthActionResult =
  | { success: true; puuid: string; region: string }
  | { success: false; error: string };

/**
 * Authenticate with a pasted URL or cookie string.
 *
 * Determines the auth type automatically based on the input:
 * - Starts with "http" → URL-based auth
 * - Otherwise → Cookie-based auth
 */
export async function authenticateWithPaste(
  pastedValue: string,
): Promise<AuthActionResult> {
  try {
    // Rate limit check before any call to Riot
    const ip = getClientIP(await headers());
    const { success } = await rateLimit(ip);
    if (!success) {
      return {
        success: false,
        error: "Too many authentication attempts. Please try again later.",
      };
    }

    const trimmed = pastedValue.trim();
    const isUrl = trimmed.startsWith("http");

    if (isUrl) {
      // URL-based auth
      const result = await completeAuthWithUrl(trimmed);

      if (!result.success) {
        return { success: false, error: result.error || "Failed to process auth URL" };
      }

      await registerAuthenticatedSession(result.tokens, result.tokens.riotCookies ?? "");

      return {
        success: true,
        puuid: result.tokens.puuid,
        region: result.tokens.region,
      };
    } else {
      // Cookie-based auth
      const result = await refreshTokensWithCookies(trimmed);

      if (!result.success) {
        return { success: false, error: result.error || "Failed to authenticate with cookies" };
      }

      await registerAuthenticatedSession(result.tokens, result.riotCookies ?? "");

      return {
        success: true,
        puuid: result.tokens.puuid,
        region: result.tokens.region,
      };
    }
  } catch (error) {
    log.error("Auth action error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Authentication failed",
    };
  }
}
