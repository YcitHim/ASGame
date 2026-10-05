import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true,
    watch: {
      // 覆盖率报告与报表不是源码，避免 dev server 空转刷新
      ignored: ["**/coverage/**", "**/reports/**", "**/dist/**"],
    },
  },
  build: {
    target: "es2020",
    sourcemap: true,
  },
});
