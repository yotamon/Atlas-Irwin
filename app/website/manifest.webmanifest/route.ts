import type { MetadataRoute } from "next";
import { marketingPath } from "@/lib/marketing-site/content";

export const dynamic = "force-static";
export function GET() {
  const manifest: MetadataRoute.Manifest = {
    name: "Ensemblis — Your music. Understood.",
    short_name: "Ensemblis",
    description: "Music intelligence for artists, producers and DJs.",
    start_url: marketingPath(),
    scope: `${marketingPath()}/`,
    display: "browser",
    background_color: "#080b09",
    theme_color: "#080b09",
    icons: [
      { src: "/ensemblis-mark.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
  return Response.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
