import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAPLIBRE_VENDORED_FILES, MAPLIBRE_WORKER_PATH } from "./maplibreWorker";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);

describe("vendored maplibre worker", () => {
  // After a maplibre-gl upgrade the worker and main bundle must match, or maps silently break.
  it.each(MAPLIBRE_VENDORED_FILES)("public copy of %s matches the installed maplibre-gl", (file) => {
    const dist = dirname(require.resolve("maplibre-gl/package.json"));
    const installed = readFileSync(join(dist, "dist", file));
    const vendored = readFileSync(join(webRoot, "public", "vendor", "maplibre", file));
    expect(vendored.equals(installed), `re-copy node_modules/maplibre-gl/dist/${file} to public/vendor/maplibre/`).toBe(true);
  });

  it("worker path points at the vendored worker", () => {
    expect(MAPLIBRE_WORKER_PATH).toBe(`/vendor/maplibre/${MAPLIBRE_VENDORED_FILES[0]}`);
  });
});
