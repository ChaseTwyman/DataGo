import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@groundtruth/shared"],
  // Native / wasm packages load their own assets at runtime; keep them out of the server bundle.
  serverExternalPackages: ["sharp", "@electric-sql/pglite", "postgres"],
};

export default config;
