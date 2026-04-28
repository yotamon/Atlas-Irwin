import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Atlas Irwin",
    short_name: "Atlas Irwin",
    description:
      "Producer, DJ, and sound designer creating groove-driven electronic music.",
    start_url: "/",
    display: "standalone",
    background_color: "#101111",
    theme_color: "#101111",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
