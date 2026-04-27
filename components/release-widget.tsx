import { getReleases } from "@/lib/releases";
import { ReleaseWidgetClient } from "@/components/release-widget-client";

export function ReleaseWidget() {
  const releases = getReleases();
  const featuredRelease = releases[0];

  if (!featuredRelease) {
    return null;
  }

  return <ReleaseWidgetClient release={featuredRelease} />;
}
