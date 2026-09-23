import { NextRequest, NextResponse } from "next/server";
import { deleteSession } from "@/lib/session";
import { removeAccount, getActiveAccount } from "@/lib/accounts";
import { rateLimit } from "@/lib/rate-limiter";
import { getClientIP, addRateLimitHeaders, createRateLimitedResponse } from "@/lib/rate-limit-utils";

export async function POST(request: NextRequest) {
  // Rate limit check before processing logout
  const ip = getClientIP(request);
  const { success, limit, remaining, reset } = await rateLimit(ip);
  if (!success) {
    return createRateLimitedResponse({ limit, remaining, reset });
  }

  // Revoke the session the cookie points at BEFORE touching the registry.
  // removeAccount() rewrites this cookie — clearing it when no account is left,
  // or replacing it via createSession() when one remains — so a deleteSession()
  // placed after it revokes the wrong row, or none at all, and leaves the JWT
  // the user just logged out of valid for its full 30 days.
  await deleteSession();

  // Get active account and remove it from the registry
  // This will automatically switch to next account or clear session if none remain
  const activeAccount = await getActiveAccount();
  if (activeAccount) {
    await removeAccount(activeAccount.puuid);
  }

  // removeAccount() may have switched to a remaining account and issued a fresh
  // session. Logout must be complete, so revoke that one too and make sure the
  // cookie ends up cleared.
  await deleteSession();

  const response = NextResponse.json({ success: true });
  return addRateLimitHeaders(response, { limit, remaining, reset });
}
