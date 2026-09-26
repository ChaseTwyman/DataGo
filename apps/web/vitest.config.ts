import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "lib/**/*.test.ts"],
    // Suites boot PGlite and apply every migration in beforeAll; with 6 migrations and files
    // running in parallel that exceeded the 10 s default (errorShape.test.ts failed a clean
    // `pnpm check` on a hook timeout, not an assertion).
    hookTimeout: 60_000,
  },
});
