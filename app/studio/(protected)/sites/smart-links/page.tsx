import Link from "next/link";
import { SmartLinksPanel } from "@/components/studio/smart-links-panel";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asSitesClient } from "@/lib/sites/db";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";

export default async function SmartLinksPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const sites = asSitesClient(supabase);
  const { data: site, error } = await sites.from("artist_sites")
    .select("id,slug,state")
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Release links"
        description={`${artist.artistName}'s owned release destinations, pre-save handoff and first-party attribution. These links are part of Ensemblis Sites, not a separate tracker.`}
        action={<Link className="button" href="/studio/sites">Back to Sites</Link>}
      />
      {!site ? (
        <section className="v2-section"><div className="v2-calm-state compact"><strong>Create the artist Site first.</strong><p>Release links inherit the artist-owned web identity and domain, so Ensemblis does not create a disconnected microsite.</p><Link className="button primary" href="/studio/sites">Create Site</Link></div></section>
      ) : site.state !== "published" ? (
        <section className="v2-section"><div className="v2-calm-state compact"><strong>Publish the Site before sharing release links.</strong><p>Smart Links are already provisioned privately, but public measurement only activates on a published artist Site.</p><Link className="button primary" href="/studio/sites">Review Site</Link></div></section>
      ) : (
        <SmartLinksPanel siteId={site.id} siteSlug={site.slug} />
      )}
    </div>
  );
}
