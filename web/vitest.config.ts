import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "cloudflare:workers": path.resolve(__dirname, "__tests__/cloudflare-workers-stub.ts"),
      "@cloudflare/containers": path.resolve(__dirname, "__tests__/cloudflare-containers-stub.ts"),
    },
  },
});
