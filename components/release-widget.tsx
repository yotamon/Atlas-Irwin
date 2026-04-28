import { getReleases } from "@/lib/releases";
import { ReleaseWidgetClient } from "@/components/release-widget-client";

export function ReleaseWidget() {
  const releases = getReleases();

  if (releases.length === 0) {
    return null;
  }

  return <ReleaseWidgetClient releases={releases} />;
}
