import Link from "next/link";
import { MediaUploader } from "@/components/studio/media-uploader";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";

function metadataTitle(metadata: unknown, fallback: string) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const typed = metadata as { title?: unknown; original_name?: unknown };
    const value = typed.title || typed.original_name;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

function metadataTags(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const tags = (metadata as { tags?: unknown }).tags;
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
}

function assetTypeLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function LibraryPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const music = asArtistScopedMusicClient(supabase);
  const [assetsResult, linksResult] = await Promise.all([
    supabase.from("media_assets").select("*").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(160),
    music.from("media_links").select("id,media_asset_id,release_id,content_item_id,role,is_primary,artist_id").eq("owner_id", user.id).eq("artist_id", artist.artistId),
  ]);
  if (assetsResult.error) throw new Error(assetsResult.error.message);
  if (linksResult.error) throw new Error(linksResult.error.message);

  const links = linksResult.data ?? [];
  const linkedAssetIds = new Set(links.map((link) => link.media_asset_id));
  const artistTag = `artist:${artist.artistId}`.toLowerCase();
  const assets = (assetsResult.data ?? []).filter((asset) =>
    linkedAssetIds.has(asset.id)
    || metadataTags(asset.metadata).some((tag) => tag.toLowerCase() === artistTag),
  ).slice(0, 80);
  const usage = new Map<string, number>();
  links.forEach((link) => usage.set(link.media_asset_id, (usage.get(link.media_asset_id) ?? 0) + 1));
  const unassigned = assets.filter((asset) => !usage.get(asset.id));
  const inUse = assets.filter((asset) => Boolean(usage.get(asset.id)));
  const visualCount = assets.filter((asset) => asset.mime_type?.startsWith("image/") || asset.mime_type?.startsWith("video/")).length;

  return (
    <div className="studio-v2-page library-polish-page">
      <PageHeader
        title="Library"
        description={`Reusable source media for ${artist.artistName}. See what is already in use, what is still available, and add new material only when it has a real role.`}
        action={<a className="button primary" href="#add-media">Add media</a>}
      />

      <section className="library-polish-summary" aria-label="Library summary">
        <div><strong>{assets.length}</strong><span>assets</span></div>
        <div><strong>{inUse.length}</strong><span>in use</span></div>
        <div><strong>{unassigned.length}</strong><span>reusable</span></div>
        <div><strong>{visualCount}</strong><span>visual</span></div>
        <Link href={ensemblisArtistHref("/studio/media", artist.artistId)}>Advanced media controls →</Link>
      </section>

      {unassigned.length ? (
        <section className="library-reusable-strip">
          <div className="v2-section-heading"><div><span className="section-label">Available material</span><h2>{unassigned.length} asset{unassigned.length === 1 ? " is" : "s are"} not attached to a release or content item</h2></div></div>
          <div className="library-reusable-list">
            {unassigned.slice(0, 6).map((asset) => {
              const title = metadataTitle(asset.metadata, asset.storage_path.split("/").at(-1) || asset.asset_type);
              return <div key={asset.id}><span>{assetTypeLabel(asset.asset_type)}</span><strong>{title}</strong><small>Reusable source material</small></div>;
            })}
          </div>
        </section>
      ) : null}

      <section className="library-visual-section">
        <div className="v2-section-heading"><div><span className="section-label">Media</span><h2>{assets.length ? "Recent visual memory" : "The artist library is empty"}</h2></div></div>
        {assets.length ? (
          <div className="library-visual-grid">
            {assets.map((asset) => {
              const title = metadataTitle(asset.metadata, asset.storage_path.split("/").at(-1) || asset.asset_type);
              const useCount = usage.get(asset.id) ?? 0;
              return (
                <article className="library-visual-item" key={asset.id}>
                  <div className="library-visual-preview">
                    {asset.public_url && asset.mime_type?.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.public_url} alt="" />
                    ) : asset.public_url && asset.mime_type?.startsWith("video/") ? (
                      <video src={asset.public_url} muted playsInline preload="metadata" />
                    ) : asset.public_url && asset.mime_type?.startsWith("audio/") ? (
                      <div className="library-audio-preview"><span>Audio</span><audio controls preload="metadata" src={asset.public_url} /></div>
                    ) : (
                      <div className="library-type-preview" aria-hidden>{asset.asset_type.slice(0, 2).toUpperCase()}</div>
                    )}
                  </div>
                  <div className="library-visual-meta">
                    <span>{assetTypeLabel(asset.asset_type)}</span>
                    <strong title={title}>{title}</strong>
                    <small>{useCount ? `Used ${useCount} time${useCount === 1 ? "" : "s"}` : "Available"}</small>
                  </div>
                </article>
              );
            })}
          </div>
        ) : <div className="v2-calm-state compact"><strong>No reusable media yet.</strong><p>Upload here or directly inside a release. Ensemblis keeps artist context attached automatically.</p></div>}
      </section>

      <details className="library-add-media" id="add-media">
        <summary>Add media to {artist.artistName}</summary>
        <div className="library-add-media-body">
          <p>Upload once and reuse it across releases, campaign content and visual references. Add context at the point of use rather than creating duplicate files.</p>
          <MediaUploader artistId={artist.artistId} defaultRole="social_image" />
        </div>
      </details>
    </div>
  );
}
