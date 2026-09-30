import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Inventario Ingeagro Torres",
    short_name: "Ingeagro",
    description: "Inventario físico de productos y torres de Ingeagro",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f8f7",
    theme_color: "#173638",
    icons: [
      { src: "/icons/ingeagro-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/ingeagro-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
