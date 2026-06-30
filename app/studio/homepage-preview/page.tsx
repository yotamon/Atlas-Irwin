import { ReleaseWidgetClient } from "@/components/release-widget-client";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { getPublicReleases } from "@/lib/public-catalog";

export const dynamic = "force-dynamic";

export default async function StudioHomepagePreview() {
  await requireStudioAdmin();
  const releases = await getPublicReleases();
  return (
    <main className="homepage-preview-document">
      {releases.length ? <ReleaseWidgetClient releases={releases} /> : <div className="preview-empty"><h1>Homepage player is empty</h1><p>Publish a release and enable its placement to preview it here.</p></div>}
    </main>
  );
}
