import { getPublicReleases } from "@/lib/public-catalog";
import { ReleaseWidgetClient } from "@/components/release-widget-client";

export async function ReleaseWidget() {
  const releases = await getPublicReleases();

  if (releases.length === 0) {
    return null;
  }

  return <ReleaseWidgetClient releases={releases} />;
}
