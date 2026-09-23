/**
 * Auth Handler Shared Utilities
 *
 * Shared schema, types, and utility functions used by all auth handler modules.
 * Extracted from src/app/api/auth/route.ts to enable per-handler testability.
 */

import { z } from "zod";
import { addAccount, migrateSessionToRegistry } from "@/lib/accounts";

export const AuthBodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("auth"),
    username: z.string(),
    password: z.string(),
  }),
  z.object({
    type: z.literal("multifactor"),
    code: z.string(),
    cookie: z.string(),
  }),
  z.object({
    type: z.literal("url"),
    url: z.string(),
  }),
  z.object({
    type: z.literal("cookie"),
    cookie: z.string(),
  }),
]);

export type AuthBody = z.infer<typeof AuthBodySchema>;

/**
 * Register the account in the multi-account registry.
 *
 * Centralises the `addAccount` call so every auth branch (credentials, MFA,
 * URL, cookie) goes through a single path. `addAccount` ends by creating the
 * session, which keeps the session cookie the last side effect of a login:
 * anything that fails before it leaves the user signed out rather than
 * silently signed in.
 */
export async function registerAuthenticatedSession(
  tokens: {
    accessToken: string;
    entitlementsToken: string;
    puuid: string;
    region: string;
    gameName?: string;
    tagLine?: string;
    country?: string;
  },
  riotCookies: string,
): Promise<void> {
  // A session that predates the registry is known only to the session cookie.
  // Register it here, while a session write is expected anyway, so that adding
  // a second account does not drop the first one from the switcher.
  await migrateSessionToRegistry();

  await addAccount(
    {
      puuid: tokens.puuid,
      region: tokens.region,
      gameName: tokens.gameName,
      tagLine: tokens.tagLine,
      addedAt: Date.now(),
    },
    {
      accessToken: tokens.accessToken,
      entitlementsToken: tokens.entitlementsToken,
      puuid: tokens.puuid,
      region: tokens.region,
      gameName: tokens.gameName,
      tagLine: tokens.tagLine,
      country: tokens.country,
      riotCookies,
    },
  );
}
