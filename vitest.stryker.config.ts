import { defineConfig } from "vitest/config";
import path from "path";

// Config dedicada ao Stryker. Difere da vitest.config.ts em dois pontos:
//   - sem `coverage`: sob mutation testing os testes rodam em subsets e os
//     thresholds de coverage falhariam em toda rodada;
//   - só o project "node": os mutantes cobertos são de src/lib e src/app/api.
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
