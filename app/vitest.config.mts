import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "../shared"),
      "@": path.resolve(import.meta.dirname, "./src"),
      // server-only tira error fuera de un server component; en los tests no aplica.
      "server-only": path.resolve(import.meta.dirname, "./node_modules/server-only/empty.js"),
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
