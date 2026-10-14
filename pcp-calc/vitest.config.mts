import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Match the tsconfig path alias so component tests can import the same way
    // the app does.
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "out/**"],
  },
});
