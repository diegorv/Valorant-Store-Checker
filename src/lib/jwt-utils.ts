/**
 * Shared JWT utilities for session and account management.
 * All JWT signing/verification uses HS256 with SESSION_SECRET.
 */

import { env } from "@/lib/env";

const _secretKey = new TextEncoder().encode(env.SESSION_SECRET);

export function getSecretKey(): Uint8Array {
  return _secretKey;
}
