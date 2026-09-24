import { initSessionDb } from './session-db';
import type { SessionData } from './schemas/session';
import { parseWithLog } from '@/lib/schemas/parse';
import { StoredSessionSchema } from '@/lib/schemas/session';
import { encrypt, decrypt, isEncrypted } from './session-crypto';
import { createLogger } from '@/lib/logger';

const log = createLogger('session-store');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 32 bytes (256 bits) rendered as hex — the only shape AES-256-GCM accepts here */
const ENCRYPTION_KEY_REGEX = /^[0-9a-f]{64}$/i;

function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

/** Sentinel thrown when a session is not found in the DB — callers treat this as a null return */
export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

/** Thrown when a sessionId fails UUID format validation */
export class InvalidSessionIdError extends TypeError {
  constructor(sessionId: string) {
    super(`Invalid session ID format (not a UUID): ${sessionId}`);
    this.name = 'InvalidSessionIdError';
  }
}

/** Thrown when Riot cookies must be stored but ENCRYPTION_KEY is unusable — never store them in plaintext */
export class SessionEncryptionUnavailableError extends Error {
  constructor() {
    super('Refusing to store Riot cookies: ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes)');
    this.name = 'SessionEncryptionUnavailableError';
  }
}

// Use global to survive Next.js hot-reload — warning fires once per process
const _warnedKeys: Record<string, boolean> = (global as unknown as Record<string, Record<string, boolean>>).__sessionStoreWarnedKeys ?? {};
(global as unknown as Record<string, Record<string, boolean>>).__sessionStoreWarnedKeys = _warnedKeys;

function getEncryptionKey(): string | null {
  // Key and guard both come from the raw process environment, never from the
  // validated env module: that module is mocked in tests, and a mocked guard is
  // no guard — a mock supplying the zero key would walk straight past this.
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    // Allowlist, not denylist: staging, preview and an unset NODE_ENV fail closed
    // instead of inheriting the development fallback.
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv !== "development" && nodeEnv !== "test") {
      throw new Error("ENCRYPTION_KEY required outside development and test — generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
    }
    if (!_warnedKeys['noKey']) {
      log.warn('ENCRYPTION_KEY not set — using fallback key. Generate a production key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
      _warnedKeys['noKey'] = true;
    }
    return '0'.repeat(64);
  }
  if (!ENCRYPTION_KEY_REGEX.test(key)) {
    if (!_warnedKeys['badKey']) {
      log.error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
      _warnedKeys['badKey'] = true;
    }
    return null;
  }
  return key;
}

export async function saveSessionToStore(sessionId: string, data: SessionData, maxAgeSeconds: number): Promise<void> {
  if (!isValidUuid(sessionId)) throw new InvalidSessionIdError(sessionId);
  const db = await initSessionDb();
  const expiresAt = Date.now() + (maxAgeSeconds * 1000);

  const key = getEncryptionKey();
  let serialized: string;

  if (data.riotCookies) {
    // Fail closed: without a usable key the cookies would land in the DB as plaintext
    if (!key) throw new SessionEncryptionUnavailableError();
    const toStore = { ...data, riotCookies: encrypt(data.riotCookies, key) };
    serialized = JSON.stringify(toStore);
  } else {
    serialized = JSON.stringify(data);
  }

  await db.execute({
    sql: 'INSERT OR REPLACE INTO sessions (id, data, expires_at) VALUES (?, ?, ?)',
    args: [sessionId, serialized, expiresAt],
  });
}

export async function getSessionFromStore(sessionId: string): Promise<SessionData | null> {
  if (!isValidUuid(sessionId)) throw new InvalidSessionIdError(sessionId);
  const db = await initSessionDb();

  let result: Awaited<ReturnType<typeof db.execute>>;
  try {
    result = await db.execute({
      sql: 'SELECT data, expires_at FROM sessions WHERE id = ?',
      args: [sessionId],
    });
  } catch (err) {
    log.error('session-store: database error fetching session %s:', sessionId, err);
    throw err; // Re-throw so callers can distinguish DB errors from not-found
  }

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0]!;
  const expiresAt = row.expires_at as number;

  if (expiresAt < Date.now()) {
    await db.execute({
      sql: 'DELETE FROM sessions WHERE id = ?',
      args: [sessionId],
    });
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(row.data as string);
  } catch {
    log.warn('session-store: corrupt session data for %s — discarding', sessionId);
    return null;
  }

  // Decrypt riotCookies if present
  const rawObj = raw as Record<string, unknown>;
  if (rawObj.riotCookies) {
    const key = getEncryptionKey();

    if (isEncrypted(rawObj.riotCookies as string)) {
      if (!key) {
        log.warn('Encrypted cookies found but no ENCRYPTION_KEY — cannot decrypt, re-login required');
        return null;
      }
      try {
        rawObj.riotCookies = decrypt(rawObj.riotCookies as string, key);
      } catch (err) {
        log.warn('Failed to decrypt riotCookies (re-login required):', err);
        return null;
      }
    }
    // If NOT encrypted (legacy plaintext): leave as-is — will be re-encrypted on next save
  }

  return parseWithLog(StoredSessionSchema, raw, "StoredSession") as SessionData | null;
}

export async function deleteSessionFromStore(sessionId: string): Promise<void> {
  if (!isValidUuid(sessionId)) throw new InvalidSessionIdError(sessionId);
  const db = await initSessionDb();
  await db.execute({
    sql: 'DELETE FROM sessions WHERE id = ?',
    args: [sessionId],
  });
}

export async function cleanupExpiredSessions(): Promise<void> {
  const db = await initSessionDb();
  await db.execute({
    sql: 'DELETE FROM sessions WHERE expires_at < ?',
    args: [Date.now()],
  });
}

/**
 * In-place UPDATE of session expiration.
 * Used by refreshSession() to extend session lifetime without
 * creating a new sessionId (avoids delete+insert race condition).
 */
export async function refreshSessionExpiration(sessionId: string, maxAgeSeconds: number): Promise<void> {
  if (!isValidUuid(sessionId)) throw new InvalidSessionIdError(sessionId);
  const db = await initSessionDb();
  const expiresAt = Date.now() + (maxAgeSeconds * 1000);
  await db.execute({
    sql: 'UPDATE sessions SET expires_at = ? WHERE id = ?',
    args: [expiresAt, sessionId],
  });
}
