import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg is a Node.js library; keep it out of the bundle
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  agentRules: false,
};

export default nextConfig;
