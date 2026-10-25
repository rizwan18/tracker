import { defineConfig } from "vitest/config";

// Pure-logic and server-rendered component tests: no browser or DOM needed.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.{ts,tsx}"],
  },
});
