import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/site-url";
import { getPublicReleases } from "@/lib/public-catalog";

const SITE_URL = getSiteUrl();

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const releases = await getPublicReleases();
  const latestReleaseUpdate = releases.reduce(
    (latest, release) => Math.max(latest, release.sortUpdatedAtMs),
    0,
  );

  return [
    {
      url: SITE_URL,
      lastModified: latestReleaseUpdate
        ? new Date(latestReleaseUpdate)
        : new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
