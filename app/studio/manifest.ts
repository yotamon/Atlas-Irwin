import type { MetadataRoute } from "next";
import { ENSEMBLIS_PRODUCT } from "@/lib/ensemblis-product";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: ENSEMBLIS_PRODUCT.name,
    short_name: ENSEMBLIS_PRODUCT.name,
    description: ENSEMBLIS_PRODUCT.promise,
    start_url: "/studio",
    scope: "/studio/",
    display: "standalone",
    background_color: "#090c0a",
    theme_color: "#090c0a",
    icons: [
      {
        src: "/ensemblis-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
