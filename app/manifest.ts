import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Atlas Irwin",
    short_name: "Atlas Irwin",
    description:
      "Producer, DJ, and sound designer creating groove-driven electronic music.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4eddd",
    theme_color: "#f4eddd",
    icons: [
      {
        src: "/atlas-cover.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
      },
    ],
  };
}
