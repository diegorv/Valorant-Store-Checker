/**
 * MSW Server Startup Hook
 *
 * This module is loaded via `node --import` before Next.js starts, completely
 * outside of the Next.js build process to avoid Turbopack analysis issues.
 * Loading it IS the opt-in — there is no ENABLE_MSW check, because a mock
 * server that silently does nothing is exactly how e2e coverage rots.
 *
 * Node resolves the relative imports below by their real `.ts` paths, so the
 * extensions are required (tsconfig sets `allowImportingTsExtensions`).
 *
 * Usage: node --import ./src/lib/msw/start.ts ./node_modules/next/dist/bin/next dev
 *        (that is the `dev:e2e` / `start:e2e` script — `next` alone is not a
 *        path Node can resolve)
 */

import { setupServer } from "msw/node";
import { handlers } from "./handlers.ts";

// Guard against double-init on hot reload
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(globalThis as any).__mswServer__) {
  const server = setupServer(...handlers);
  // "warn", not "bypass": a handler whose URL no longer matches used to fall
  // through to the real API in silence, which is how the broken handlers went
  // unnoticed. Unhandled requests still pass through, but they say so.
  server.listen({ onUnhandledRequest: "warn" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__mswServer__ = server;
  console.log("[MSW] Node server started for E2E tests");
}