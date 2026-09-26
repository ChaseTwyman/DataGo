import { defineConfig } from "vitest/config";

// Only pure TS modules are unit-tested here (no react-native imports), so a node env is enough.
export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
