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

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Library"
        description={`Reusable media for ${artist.artistName}. Shared binaries stay workspace-safe, while artist tags and usages decide what appears in this library.`}
        action={<Link className="button" href={ensemblisArtistHref("/studio/media", artist.artistId)}>Advanced media library</Link>}
      />

      <section className="v2-status-grid">
        <article><strong>{assets.length}</strong><span>recent assets</span><small>Active artist library</small></article>
        <article><strong>{links.length}</strong><span>assignments</span><small>Release and content usage</small></article>
        <article><strong>{unassigned.length}</strong><span>unassigned</span><small>Reusable or needs context</small></article>
        <article><strong>{assets.filter((asset) => asset.asset_type === "cover").length}</strong><span>covers</span><small>Artwork in library</small></article>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Add media</span><h2>Upload once, reuse for {artist.artistName}</h2></div></div>
        <MediaUploader artistId={artist.artistId} defaultRole="social_image" />
      </section>

      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Recent</span><h2>Visual memory</h2></div></div>
        {assets.length ? (
          <div className="v2-library-grid">
            {assets.map((asset) => {
              const title = metadataTitle(asset.metadata, asset.storage_path.split("/").at(-1) || asset.asset_type);
              return (
                <article key={asset.id}>
                  <div className="v2-library-preview">
                    {asset.public_url && asset.mime_type?.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.public_url} alt="" />
                    ) : asset.public_url && asset.mime_type?.startsWith("video/") ? (
                      <video src={asset.public_url} muted playsInline preload="metadata" />
                    ) : (
                      <div aria-hidden>{asset.asset_type.slice(0, 2).toUpperCase()}</div>
                    )}
                  </div>
                  <div className="v2-library-meta">
                    <span>{asset.asset_type.replaceAll("_", " ")}</span>
                    <strong title={title}>{title}</strong>
                    <small>{usage.get(asset.id) ? `Used ${usage.get(asset.id)} time${usage.get(asset.id) === 1 ? "" : "s"}` : "Not assigned yet"}</small>
                  </div>
                </article>
              );
            })}
          </div>
        ) : <div className="v2-calm-state compact"><strong>The artist library is empty.</strong><p>Upload media here or directly inside a release. Ensemblis will keep its artist context attached automatically.</p></div>}
      </section>
    </div>
  );
}
