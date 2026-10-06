import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

/**
 * 部署基路径。
 * - 本地开发 / 自建根域名：默认 "/"
 * - GitHub Pages 项目站点（https://<user>.github.io/<repo>/）：由 CI 注入
 *   BASE_PATH=/<repo>，构建产物里资源链接才会带上仓库前缀，否则会 404 白屏。
 */
const rawBase = process.env.BASE_PATH ?? "/";
const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;

export default defineConfig({
  base,
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
