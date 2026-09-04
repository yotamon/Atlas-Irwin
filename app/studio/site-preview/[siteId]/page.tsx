import { notFound } from "next/navigation";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { parseSiteConfig, parseSiteViewModel } from "@/lib/sites/domain";
import { asSitesClient } from "@/lib/sites/db";
import { getSiteTemplate } from "@/lib/sites/templates/registry";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";

type PageProps = {
  params: Promise<{ siteId: string }>;
};

export default async function PrivateSitePreviewPage({ params }: PageProps) {
  const { siteId } = await params;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const sites = asSitesClient(supabase);

  const { data: site, error: siteError } = await sites
    .from("artist_sites")
    .select("*")
    .eq("id", siteId)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (siteError) throw new Error(siteError.message);
  if (!site) notFound();

  const versionId = site.draft_version_id || site.published_version_id;
  if (!versionId) notFound();
  const { data: version, error: versionError } = await sites
    .from("artist_site_versions")
    .select("*")
    .eq("id", versionId)
    .eq("site_id", site.id)
    .maybeSingle();
  if (versionError) throw new Error(versionError.message);
  if (!version) notFound();

  const definition = getSiteTemplate(site.template_key);
  const Template = definition.render;

  return (
    <Template
      preview
      config={parseSiteConfig(version.config)}
      viewModel={parseSiteViewModel(version.content_snapshot)}
    />
  );
}
