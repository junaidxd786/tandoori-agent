import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow ngrok domains in development
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app"],
  
  // Required to allow the webhook handler to return 200 immediately
  // while processing happens asynchronously
  experimental: {
    serverActions: {
      allowedOrigins: ["*"],
    },
  },
};

export default nextConfig;
