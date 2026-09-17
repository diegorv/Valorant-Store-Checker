import { defineConfig } from "vitest/config";
import path from "path";

// Stryker-only config. It differs from vitest.config.ts in two ways:
//   - no `coverage`: under mutation testing each run executes a subset of the
//     tests, so the coverage thresholds would fail on every run;
//   - the "node" project only: everything we mutate lives in src/lib and
//     src/app/api.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["./test/setup.node.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
