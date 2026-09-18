import { defineConfig } from "playwright/test";

/**
 * Port 3000 is a minefield: anything else already listening there (a Grafana
 * container, another dev server) answers 200 on `/` and `/login` too, so a
 * config that reuses an existing server silently runs the whole suite against
 * the wrong application. This suite therefore uses its own port and never
 * reuses a server it did not start — if the port is taken, Playwright fails
 * loudly instead of testing a stranger.
 */
const port = Number(process.env.E2E_PORT ?? 3101);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // The HTML report is unreadable in a CI log; "list" prints each test there.
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    // `next dev` alone does NOT load MSW — the mock server is installed by
    // `node --import src/lib/msw/start.ts`, which `dev:e2e` does.
    command: `pnpm dev:e2e --port ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ENABLE_MSW: "true",
      // A developer's .env.local may point TURSO_DATABASE_URL at a real hosted
      // database — the wishlist test writes, so without this the suite mutates
      // it for real. Empty means "not remote" (src/lib/session-db.ts), which
      // sends sessions and wishlists to the throwaway file below instead.
      TURSO_DATABASE_URL: "",
      SESSION_DB_PATH: ".session-data/e2e.db",
    },
  },
});
