import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

const localAddresses = process.env.NODE_ENV === "development"
  ? Object.values(networkInterfaces()).flatMap((entries) =>
      (entries ?? [])
        .filter((entry) => entry.family === "IPv4" && !entry.internal)
        .map((entry) => entry.address),
    )
  : [];

const nextConfig: NextConfig = {
  ...(process.env.NODE_ENV === "development" ? {
    // Next dev debe servir sus recursos también desde las IP locales del equipo.
    allowedDevOrigins: ["127.0.0.1", ...new Set(localAddresses)],
  } : {}),
};

export default nextConfig;
