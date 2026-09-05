import Link from "next/link";
import { setSmartLinkDestinationActiveAction, upsertSmartLinkDestinationAction } from "@/app/studio/smart-link-actions";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asSitesClient } from "@/lib/sites/db";
import { asSmartLinksClient } from "@/lib/smart-links/db";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";

export async function SmartLinksPanel({ siteId, siteSlug }: { siteId: string; siteSlug: string }) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const smart = asSmartLinksClient(supabase);
  const music = asArtistScopedMusicClient(supabase);
  const sites = asSitesClient(supabase);
  const [linksResult, releasesResult, domainsResult] = await Promise.all([
    smart.from("smart_links").select("*").eq("site_id", siteId).eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("is_active", true).order("created_at", { ascending: false }),
    music.from("releases").select("id,title,release_date").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    sites.from("artist_site_domains").select("hostname,is_primary,verification_status,ssl_status").eq("site_id", siteId).eq("is_primary", true).maybeSingle(),
  ]);
  const firstError = [linksResult, releasesResult, domainsResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const links = linksResult.data ?? [];
  const releaseById = new Map((releasesResult.data ?? []).map((release) => [release.id, release]));
  const domain = domainsResult.data;
  const liveHostname = domain?.verification_status === "verified" && domain.ssl_status === "active" ? domain.hostname : null;
  if (!links.length) return null;

  const linkIds = links.map((link) => link.id);
  const [destinationsResult, readbackResult, sourcesResult] = await Promise.all([
    smart.from("smart_link_destinations").select("*").in("smart_link_id", linkIds).order("sort_order", { ascending: true }),
    smart.from("smart_link_readback").select("*").in("smart_link_id", linkIds),
    smart.from("smart_link_sources").select("id,smart_link_id,content_item_id,moment_id").in("smart_link_id", linkIds),
  ]);
  const detailError = [destinationsResult, readbackResult, sourcesResult].find((result) => result.error)?.error;
  if (detailError) throw new Error(detailError.message);
  const destinations = destinationsResult.data ?? [];
  const readbackByLink = new Map((readbackResult.data ?? []).map((row) => [row.smart_link_id, row]));
  const sources = sourcesResult.data ?? [];

  return (
    <section className="v2-section" id="smart-links">
      <div className="v2-section-heading">
        <div>
          <span className="section-label">Release destinations</span>
          <h2>Smart Links live on the artist&apos;s own web presence</h2>
        </div>
      </div>
      <p className="v2-muted-copy">Each release URL stays stable before and after launch. Pre-save destinations are shown before release day; streaming destinations take over automatically when the release goes live. Measurement is first-party and sessionless.</p>

      <div className="v2-simple-list">
        {links.map((link) => {
          const release = releaseById.get(link.release_id);
          const rows = destinations.filter((destination) => destination.smart_link_id === link.id);
          const readback = readbackByLink.get(link.id);
          const sourceCount = sources.filter((source) => source.smart_link_id === link.id).length;
          const publicPath = liveHostname ? `https://${liveHostname}/release/${link.slug}` : `/sites/${siteSlug}/release/${link.slug}`;
          return (
            <article key={link.id} className="v2-plan-card">
              <div>
                <span>{release?.release_date ? `Release · ${release.release_date}` : "Release"}</span>
                <h3>{release?.title || "Release Smart Link"}</h3>
                <p><a href={publicPath} target="_blank" rel="noreferrer">{publicPath} ↗</a></p>
                <small>{rows.filter((row) => row.is_active).length} active destination{rows.filter((row) => row.is_active).length === 1 ? "" : "s"} · {sourceCount} attributed content source{sourceCount === 1 ? "" : "s"}</small>
              </div>
              <div className="v2-status-grid">
                <div><strong>{readback?.landing_views ?? 0}</strong><span>landings</span></div>
                <div><strong>{(readback?.outbound_clicks ?? 0) + (readback?.pre_save_starts ?? 0)}</strong><span>actions</span></div>
                <div><strong>{readback?.launch_actions_day_7 ?? 0}</strong><span>day 7</span></div>
                <div><strong>{readback?.launch_actions_day_30 ?? 0}</strong><span>day 30</span></div>
              </div>
              {rows.length ? <div className="media-tags">{rows.map((destination) => (
                <form action={setSmartLinkDestinationActiveAction} key={destination.id}>
                  <input type="hidden" name="destinationId" value={destination.id} />
                  <input type="hidden" name="active" value={destination.is_active ? "false" : "true"} />
                  <button className="button" type="submit">{destination.is_active ? "●" : "○"} {destination.label} · {destination.destination_kind.replaceAll("_", " ")}</button>
                </form>
              ))}</div> : null}
              <details className="studio-advanced-details">
                <summary><span>Add pre-save or fallback destination</span><small>Streaming destinations already sync from canonical release links.</small></summary>
                <form action={upsertSmartLinkDestinationAction} className="form-grid">
                  <input type="hidden" name="smartLinkId" value={link.id} />
                  <label className="field"><span>Type</span><select name="destinationKind" defaultValue="pre_save"><option value="pre_save">Pre-save</option><option value="fallback">Fallback</option></select></label>
                  <label className="field"><span>Provider</span><input name="provider" required placeholder="spotify-presave" /></label>
                  <label className="field"><span>Label</span><input name="label" required placeholder="Pre-save on Spotify" /></label>
                  <label className="field wide"><span>Destination URL</span><input type="url" name="destinationUrl" required placeholder="https://…" /></label>
                  <div className="actions"><button className="button primary" type="submit">Save destination</button></div>
                </form>
              </details>
              {release ? <Link href={`/studio/releases/${release.id}?stage=publish`}>Open release →</Link> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
