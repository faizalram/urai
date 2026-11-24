import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rotom · Diagnosa Honda BeAT",
    short_name: "Rotom",
    start_url: "/",
    display: "standalone",
    background_color: "#0e141c",
    theme_color: "#0e141c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
