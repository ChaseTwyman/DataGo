import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@groundtruth/shared"],
  serverExternalPackages: ["sharp"],
};

export default config;
