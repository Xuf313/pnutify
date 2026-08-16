import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow your iPhone's local network IP to access the dev server
  allowedDevOrigins: ["192.168.0.14"],
};

export default nextConfig;