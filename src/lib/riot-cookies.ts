/**
 * Riot Cookie Utilities
 *
 * Manages Riot session cookie parsing and merging.
 * Extracted from riot-auth.ts (Phase 10 decomposition).
 */

import { RiotSessionCookies } from "./riot-auth";

/**
 * Merges existing cookies with new set-cookie headers.
 * New cookies with the same name override old ones. Only each header's leading
 * name=value pair is a cookie; the rest are attributes. A header whose Max-Age
 * is zero or negative, or whose Expires is in the past, deletes the cookie.
 * An empty value alone does not delete.
 */
export function mergeCookies(existing: string, newSetCookieHeaders: string[]): string {
  const cookieMap = new Map<string, string>();

  // Parse existing cookies
  for (const pair of existing.split("; ")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx > 0) {
      cookieMap.set(pair.substring(0, eqIdx), pair);
    }
  }

  // Override with new cookies
  for (const header of newSetCookieHeaders) {
    const [first = "", ...attributes] = header.split(";");
    const cookiePart = first.trim();
    const eqIdx = cookiePart.indexOf("=");
    if (eqIdx <= 0) continue;
    const name = cookiePart.substring(0, eqIdx);
    if (attributes.some(isExpiryInPast)) {
      cookieMap.delete(name);
    } else {
      cookieMap.set(name, cookiePart);
    }
  }

  return Array.from(cookieMap.values()).join("; ");
}

/** True for a Max-Age of zero or less, or an Expires date already past. */
function isExpiryInPast(attribute: string): boolean {
  const eqIdx = attribute.indexOf("=");
  if (eqIdx <= 0) return false;
  const key = attribute.substring(0, eqIdx).trim().toLowerCase();
  const value = attribute.substring(eqIdx + 1).trim();
  if (key === "max-age") return Number(value) <= 0;
  if (key === "expires") return Date.parse(value) <= Date.now();
  return false;
}

/**
 * Extracts individual named Riot cookies from a raw cookie string.
 * RadiantConnect tracks ssid, clid, csid, tdid separately for SSID re-auth.
 */
export function extractNamedCookies(cookieString: string): RiotSessionCookies {
  const result: RiotSessionCookies = { raw: cookieString };
  for (const pair of cookieString.split("; ")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx <= 0) continue;
    const name = pair.substring(0, eqIdx).trim();
    const value = pair.substring(eqIdx + 1);
    switch (name) {
      case "ssid":
        result.ssid = value;
        break;
      case "clid":
        result.clid = value;
        break;
      case "csid":
        result.csid = value;
        break;
      case "tdid":
        result.tdid = value;
        break;
    }
  }
  return result;
}

/**
 * Builds a minimal cookie string from only the essential Riot cookies.
 * Keeping only ssid/clid/csid/tdid prevents the session JWT from growing
 * past the browser's 4 KB cookie limit after repeated refreshes.
 */
export function buildEssentialCookieString(named: RiotSessionCookies): string {
  const parts: string[] = [];
  if (named.ssid) parts.push(`ssid=${named.ssid}`);
  if (named.clid) parts.push(`clid=${named.clid}`);
  if (named.csid) parts.push(`csid=${named.csid}`);
  if (named.tdid) parts.push(`tdid=${named.tdid}`);
  return parts.join("; ");
}

/** Helper: safely capture Set-Cookie headers from a fetch response. */
export function captureSetCookies(response: Response): string[] {
  try {
    return response.headers.getSetCookie();
  } catch {
    // Fallback: getSetCookie() may not exist in all runtimes
    const raw = response.headers.get("set-cookie");
    if (raw) {
      return raw.split(/,(?=\s*\w+=)/);
    }
    return [];
  }
}
