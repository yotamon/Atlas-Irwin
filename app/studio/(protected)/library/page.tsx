import Link from "next/link";
import { MediaUploader } from "@/components/studio/media-uploader";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";

function metadataTitle(metadata: unknown, fallback: string) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const typed = metadata as { title?: unknown; original_name?: unknown };
    const value = typed.title || typed.original_name;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

export default async function LibraryPage() {
  const { supabase, user } = await requireStudioAdmin();
  const [assetsResult, linksResult] = await Promise.all([
    supabase.from("media_assets").select("*").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(80),
    supabase.from("media_links").select("id,media_asset_id,release_id,content_item_id,role,is_primary").eq("owner_id", user.id),
  ]);
  if (assetsResult.error) throw new Error(assetsResult.error.message);
  if (linksResult.error) throw new Error(linksResult.error.message);
  const assets = assetsResult.data ?? [];
  const links = linksResult.data ?? [];
  const usage = new Map<string, number>();
  links.forEach((link) => usage.set(link.media_asset_id, (usage.get(link.media_asset_id) ?? 0) + 1));
  const unassigned = assets.filter((asset) => !usage.get(asset.id));

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Library"
        description="A calm view of reusable media. Contextual uploads inside releases and Production attach themselves automatically; use the advanced library only for maintenance."
        action={<Link className="button" href="/studio/media">Advanced media library</Link>}
      />

      <section className="v2-status-grid">
        <article><strong>{assets.length}</strong><span>recent assets</span><small>Latest 80 loaded</small></article>
        <article><strong>{links.length}</strong><span>assignments</span><small>Release and content usage</small></article>
        <article><strong>{unassigned.length}</strong><span>unassigned</span><small>Reusable or needs context</small></article>
        <article><strong>{assets.filter((asset) => asset.asset_type === "cover").length}</strong><span>covers</span><small>Artwork in library</small></article>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Add media</span><h2>Upload once, reuse everywhere</h2></div></div>
        <MediaUploader defaultRole="social_image" />
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
        ) : <div className="v2-calm-state compact"><strong>The library is empty.</strong><p>Upload media here or directly inside a release where Atlas can assign the context automatically.</p></div>}
      </section>
    </div>
  );
}
