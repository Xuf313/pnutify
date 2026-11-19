import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let a phone on your Wi-Fi open the dev server, e.g. DEV_ORIGINS=192.168.0.14
  allowedDevOrigins: (process.env.DEV_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
};

export default nextConfig;
