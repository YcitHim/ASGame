import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      reportsDirectory: "coverage",
      // 门禁 2：pipeline 行覆盖率 ≥ 90%；全局下限防整体倒退
      thresholds: { lines: 90, functions: 90, branches: 80 },
    },
  },
});
