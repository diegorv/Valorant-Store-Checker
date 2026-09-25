/**
 * Session Management Module
 *
 * Handles secure session creation, retrieval, and deletion.
 * Migrated to Server-Side Storage with Reference Cookies.
 *
 * Security features:
 * - Session Data stored server-side (JSON Store)
 * - Client receives ONLY a sessionId in the cookie
 * - HTTP-only cookies
 * - Secure flag
 * - SameSite=Lax
 */

import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { refreshTokensWithCookies } from "./riot-reauth";
import { cookies } from "next/headers";
import { createLogger } from "./logger";
import { randomUUID } from "crypto";
import {
  saveSessionToStore,
  getSessionFromStore,
  deleteSessionFromStore,
  refreshSessionExpiration
} from "./session-store";
import type { StoredSession as SessionData } from "./schemas/session";
import { ESSENTIAL_COOKIE_NAMES } from "./constants";
import { getSecretKey } from "./jwt-utils";

const log = createLogger("session");

const SESSION_COOKIE_NAME = "valorant_session";

/**
 * Whether the session cookie must carry `Secure`.
 *
 * Allowlist, not denylist: only an explicit development or test environment may
 * issue a cookie the browser will send over plain HTTP; every other value gets
 * `Secure`. Next inlines `process.env.NODE_ENV` at build time — "development"
 * for `next dev`, "production" for every other command — so in a built app this
 * is hardening at the source, not a branch a deployment can reach. Read from
 * process.env, never from the env module: the test suite mocks that module, and
 * a mocked guard is no guard.
 *
 * accounts.ts keeps its own copy for that same reason. Change both together.
 */
function secureCookies(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  return nodeEnv !== "development" && nodeEnv !== "test";
}

// ---------------------------------------------------------------------------
// Module-level LRU cache for Route Handler session deduplication
//
// React.cache() (getCachedSessionInternal) dedups RSC tree calls within a
// single render pass. But Route Handlers each get a fresh module instance,
// so every handler call still does JWT verify + SQLite read.
//
// This LRU caches the full {sessionId, data} result keyed by token value.
// TTL of 30s means stale tokens are never served (refresh path still runs).
// Max 10 entries prevents memory bloat in long-running processes.
// ---------------------------------------------------------------------------
interface LRUEntry {
  result: { sessionId: string; data: SessionData };
  expiresAt: number;
}

class LRUCache {
  private cache = new Map<string, LRUEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries = 10, ttlMs = 30_000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(token: string): { sessionId: string; data: SessionData } | null {
    const entry = this.cache.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(token);
      return null;
    }
    // Move to end (most recently used) — approximate LRU
    this.cache.delete(token);
    this.cache.set(token, entry);
    return entry.result;
  }

  set(token: string, result: { sessionId: string; data: SessionData }): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(token, { result, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(token: string): void {
    this.cache.delete(token);
  }

  clear(): void {
    this.cache.clear();
  }
}

const _sessionCache = new LRUCache(10, 30_000);

/** Resets the LRU cache — for test isolation only */
export function _resetSessionCache(): void {
  _sessionCache.clear();
}
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days in seconds
const TOKEN_EXPIRY_THRESHOLD = 55 * 60 * 1000; // 55 minutes in ms
const TOKEN_HARD_EXPIRY = 65 * 60 * 1000; // 65 minutes

// Export SessionData for other consumers (re-export)
export type { StoredSession as SessionData } from "./schemas/session";

interface SessionTokenPayload {
  sessionId: string;
  [key: string]: unknown;
}

/**
 * Creates a server-side session and sets a reference cookie
 */
export async function createSession(tokens: {
  accessToken: string;
  idToken?: string;
  entitlementsToken: string;
  puuid: string;
  region: string;
  gameName?: string;
  tagLine?: string;
  country?: string;
  riotCookies?: string;
}): Promise<void> {
  // 0. Revoke the session this one replaces.
  //
  // Overwriting the cookie below makes the previous row unreachable through
  // the app, but it stayed valid in the store for the full 30-day TTL — a JWT
  // captured before a login, an addAccount or a switchAccount kept working
  // against it. Doing this here covers every caller that replaces a session.
  //
  // Per-account copies (valorant_session_<short>) live under their own ids and
  // are not touched, so switching back to an account still works.
  await revokeCurrentSession();

  // 1. Filter cookies (legacy logic, still good to keep data small)
  const filteredCookies = tokens.riotCookies
    ? tokens.riotCookies
        .split("; ")
        .filter((pair) => ESSENTIAL_COOKIE_NAMES.has(pair.split("=")[0]?.trim() ?? ""))
        .join("; ")
    : undefined;

  // 2. Prepare Session Data
  const sessionData: SessionData = {
    accessToken: tokens.accessToken,
    idToken: tokens.idToken,
    entitlementsToken: tokens.entitlementsToken,
    puuid: tokens.puuid,
    region: tokens.region,
    gameName: tokens.gameName,
    tagLine: tokens.tagLine,
    country: tokens.country,
    riotCookies: filteredCookies || undefined,
    createdAt: Date.now(),
  };

  // 3. Generate Session ID
  const sessionId = randomUUID();

  // 4. Store Session Data Server-Side
  await saveSessionToStore(sessionId, sessionData, SESSION_MAX_AGE);

  // 5. Create Lightweight JWT Payload
  const payload: SessionTokenPayload = { sessionId };

  // 6. Sign JWT
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecretKey());

  // 7. Set Cookie
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  
  log.debug("Created new session %s", sessionId);
}

/**
 * Internal: retrieves session ID + data from the cookie/store.
 * Returns both so callers can update the store in-place without touching cookies.
 */
async function getSessionInternal(): Promise<{ sessionId: string; data: SessionData } | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!token) return null;

    // LRU cache check: skip JWT + SQLite if token was just verified
    const cached = _sessionCache.get(token);
    if (cached) {
      log.debug("Session %s served from LRU cache", cached.sessionId);
      return cached;
    }

    const { payload } = await jwtVerify(token, getSecretKey());
    const sessionId = (payload as SessionTokenPayload).sessionId;

    if (!sessionId) {
      log.warn("Invalid session token payload");
      return null;
    }

    const sessionData = await getSessionFromStore(sessionId);

    if (!sessionData) {
      log.warn("Session %s not found in store (expired/deleted)", sessionId);
      return null;
    }

    const result = { sessionId, data: sessionData };
    _sessionCache.set(token, result);
    return result;

  } catch (error) {
    log.error("Session retrieval failed:", error);
    return null;
  }
}

/**
 * Cached version of getSessionInternal for RSC render-pass dedup.
 * React.cache() ensures only ONE SQLite read per render pass,
 * even when Header, Layout, and Page all call getSession().
 *
 * Scope: per-request (per RSC render pass). Does NOT persist across requests.
 * Does NOT deduplicate Route Handler calls (only RSC tree).
 */
const getCachedSessionInternal = cache(getSessionInternal);

/**
 * Retrieves session by reference ID from cookie
 */
export async function getSession(): Promise<SessionData | null> {
  const result = await getCachedSessionInternal();
  return result?.data ?? null;
}

/**
 * Gets the current session ID (UUID) from the session cookie.
 * Returns null if no valid session exists.
 *
 * Use this as a lightweight authentication guard (e.g., wishlist reads/writes).
 * For general session data access, use getSession() instead.
 */
export async function getCurrentSessionId(): Promise<string | null> {
  // Read sessionId directly from JWT — no DB round-trip needed
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return (payload as SessionTokenPayload).sessionId ?? null;
  } catch {
    return null;
  }
}

/**
 * Revokes the session the cookie currently points at, without touching the
 * cookie itself — which is what makes it safe from a Server Component, where
 * cookies cannot be written.
 *
 * Drops the row from the store AND evicts the token from the LRU — skipping
 * the eviction would let a replayed JWT be served from cache for up to the
 * cache TTL after its row is gone.
 *
 * A deleted cookie reads back as an empty string rather than undefined, so an
 * already-cleared cookie falls out on the `!token` guard.
 */
export async function revokeCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) return;

  _sessionCache.invalidate(token);
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    const sessionId = (payload as SessionTokenPayload).sessionId;
    if (sessionId) {
      log.debug("Revoking session %s", sessionId);
      await deleteSessionFromStore(sessionId);
    }
  } catch {
    log.warn("Failed to revoke session from store: invalid token");
  }
}

/**
 * Internal: drops a session the refresh path has found dead.
 *
 * Deletes the store row AND evicts the current token from the LRU. Without
 * the eviction the next request (for up to the LRU TTL) is still served the
 * deleted row from cache: /store sees "dead, go to /login", /login sees
 * "cached session, go to /store", and the browser gives up with
 * ERR_TOO_MANY_REDIRECTS. Reads the cookie itself because the cached result
 * only carries the sessionId, not the token the LRU is keyed by.
 */
async function dropDeadSession(sessionId: string): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) _sessionCache.invalidate(token);
  await deleteSessionFromStore(sessionId);
}

/**
 * Deletes session from store AND cookie.
 * ONLY safe to call from Route Handlers or Server Actions.
 */
export async function deleteSession(): Promise<void> {
  await revokeCurrentSession();
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function refreshSession(): Promise<boolean> {
  const result = await getSessionInternal();
  if (!result) return false;

  const { sessionId } = result;

  // Update expires_at in-place — no new sessionId needed
  await refreshSessionExpiration(sessionId, SESSION_MAX_AGE);

  // Update cookie maxAge (preserve existing JWT token)
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? '';
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });

  return true;
}

/**
 * Gets session and refreshes tokens if expired.
 * Safe to call from ANY context (Server Components, Route Handlers, etc.)
 * because it only updates server-side store data, never modifies cookies.
 */
export async function getSessionWithRefresh(): Promise<SessionData | null> {
  const result = await getCachedSessionInternal();

  if (!result) {
    return null;
  }

  const { sessionId, data: session } = result;
  const tokenAge = Date.now() - (session.createdAt || 0);
  const isTokenExpired = tokenAge > TOKEN_EXPIRY_THRESHOLD;

  if (!isTokenExpired) {
    return session;
  }

  log.info(
    "Access token likely expired (age: %dmin), attempting SSID refresh",
    Math.round(tokenAge / 60000),
  );

  const isTokenDefinitelyDead = tokenAge > TOKEN_HARD_EXPIRY;

  if (!session.riotCookies) {
    log.warn("No stored Riot cookies for token refresh");
    if (isTokenDefinitelyDead) {
      await dropDeadSession(sessionId);
      return null;
    }
    return { ...session, _refreshFailed: true };
  }

  try {
    const refreshResult = await refreshTokensWithCookies(session.riotCookies);

    if (!refreshResult.success) {
      log.warn("Token refresh failed: %s", refreshResult.error);
      if (isTokenDefinitelyDead) {
        await dropDeadSession(sessionId);
        return null;
      }
      return { ...session, _refreshFailed: true };
    }

    // Update store in-place with refreshed data (no cookie change needed)
    const freshSession: SessionData = {
      accessToken: refreshResult.tokens.accessToken,
      idToken: refreshResult.tokens.idToken,
      entitlementsToken: refreshResult.tokens.entitlementsToken,
      puuid: refreshResult.tokens.puuid,
      region: refreshResult.tokens.region,
      gameName: refreshResult.tokens.gameName,
      tagLine: refreshResult.tokens.tagLine,
      country: refreshResult.tokens.country,
      riotCookies: refreshResult.riotCookies,
      createdAt: Date.now(),
    };

    await saveSessionToStore(sessionId, freshSession, SESSION_MAX_AGE);

    // Invalidate LRU cache so next getSessionInternal() call fetches fresh data
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (token) _sessionCache.invalidate(token);

    log.info("Session refreshed successfully (in-place update)");

    return freshSession;
  } catch (error) {
    log.error("Token refresh error:", error);
    if (isTokenDefinitelyDead) {
      await dropDeadSession(sessionId);
      return null;
    }
    return { ...session, _refreshFailed: true };
  }
}
