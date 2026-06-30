/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { attachMediaAsset, uploadLibraryMedia } from "@/app/studio/catalog-actions";
import { Field, PageHeader, Status, Submit } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import type { Json, MediaAsset } from "@/types/database";

function metadataValue(metadata: Json, key: string) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const value = metadata[key];
    return typeof value === "string" ? value : null;
  }
  return null;
}

function fileSize(value: number | null) {
  if (!value) return "Size unavailable";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

export default async function MediaLibraryPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; visibility?: string; view?: string; sort?: string }> }) {
  const params = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const [assetsResult, linksResult, releasesResult] = await Promise.all([
    supabase.from("media_assets").select("*").eq("owner_id", user.id).order(params.sort === "oldest" ? "created_at" : "created_at", { ascending: params.sort === "oldest" }),
    supabase.from("media_links").select("*").eq("owner_id", user.id),
    supabase.from("releases").select("id,title").eq("owner_id", user.id).order("title"),
  ]);
  const links = linksResult.data ?? [];
  const releases = releasesResult.data ?? [];
  const releaseById = new Map(releases.map((release) => [release.id, release]));
  let assets = (assetsResult.data ?? []) as MediaAsset[];
  if (params.type) assets = assets.filter((asset) => asset.asset_type === params.type);
  if (params.visibility) assets = assets.filter((asset) => asset.visibility === params.visibility);
  if (params.q) {
    const query = params.q.toLowerCase();
    assets = assets.filter((asset) => `${asset.storage_path} ${asset.asset_type} ${metadataValue(asset.metadata, "original_name") ?? ""}`.toLowerCase().includes(query));
  }
  if (params.sort === "used") assets.sort((a, b) => links.filter((link) => link.media_asset_id === b.id).length - links.filter((link) => link.media_asset_id === a.id).length);
  if (params.sort === "type") assets.sort((a, b) => a.asset_type.localeCompare(b.asset_type));

  return (
    <>
      <PageHeader title="Media Library" description="The visual source of truth for public artwork, campaign assets, previews, masters, and stems." />
      <section className="media-toolbar" aria-label="Media filters">
        <form className="media-search">
          <input name="q" defaultValue={params.q} placeholder="Search filename, type, or source" aria-label="Search media" />
          <select name="type" defaultValue={params.type ?? ""} aria-label="Filter by media type"><option value="">All types</option>{["cover", "alternate_artwork", "audio_preview", "canvas_video", "visualizer", "social_image", "lyric_video", "press_image", "content_video", "master_audio", "stem"].map((type) => <option value={type} key={type}>{type.replaceAll("_", " ")}</option>)}</select>
          <select name="visibility" defaultValue={params.visibility ?? ""} aria-label="Filter by visibility"><option value="">Public + private</option><option value="public">Public</option><option value="private">Private</option></select>
          <select name="sort" defaultValue={params.sort ?? "recent"} aria-label="Sort media"><option value="recent">Recently added</option><option value="oldest">Oldest first</option><option value="used">Most used</option><option value="type">Type</option></select>
          <button className="button">Apply</button>
        </form>
        <div className="view-toggle"><Link className={params.view !== "list" ? "active" : undefined} href={{ query: { ...params, view: "grid" } }}>Grid</Link><Link className={params.view === "list" ? "active" : undefined} href={{ query: { ...params, view: "list" } }}>List</Link></div>
      </section>

      <details className="upload-drawer" id="upload">
        <summary>Upload to library <span>Public assets require an explicit visibility confirmation.</span></summary>
        <form action={uploadLibraryMedia} className="studio-form">
          <div className="form-grid">
            <Field label="Asset type"><select name="asset_type" defaultValue="content_video">{["cover", "alternate_artwork", "audio_preview", "canvas_video", "visualizer", "social_image", "lyric_video", "press_image", "content_video", "master_audio", "stem"].map((type) => <option value={type} key={type}>{type.replaceAll("_", " ")}</option>)}</select></Field>
            <Field label="Visibility"><select name="visibility" defaultValue="private"><option value="private">Private production</option><option value="public">Intentional public asset</option></select></Field>
            <Field label="File"><input type="file" name="file" required /></Field>
            <Field label="Public confirmation"><span className="checkbox-field"><input type="checkbox" name="confirm_public" /> I confirm this file may be served publicly</span></Field>
          </div>
          <Submit>Upload asset</Submit>
        </form>
      </details>

      {assets.length ? (
        <section className={params.view === "list" ? "media-list" : "media-grid"} aria-label={`${assets.length} media assets`}>
          {assets.map((asset) => {
            const usage = links.filter((link) => link.media_asset_id === asset.id);
            const releaseUses = [...new Set(usage.map((link) => link.release_id).filter(Boolean))].map((id) => releaseById.get(id!)).filter(Boolean);
            return (
              <article className="media-card" key={asset.id}>
                <div className="media-thumb">
                  {asset.public_url && asset.mime_type?.startsWith("image/") ? <img src={asset.public_url} alt="" /> : asset.public_url && asset.mime_type?.startsWith("video/") ? <video src={asset.public_url} muted preload="metadata" /> : <span>{asset.asset_type.replaceAll("_", " ")}</span>}
                  <Status>{asset.visibility}</Status>
                </div>
                <div className="media-card-body">
                  <div><span className="section-label">{asset.asset_type.replaceAll("_", " ")}</span><h2>{metadataValue(asset.metadata, "original_name") || asset.storage_path.split("/").at(-1)}</h2></div>
                  <dl className="asset-meta"><div><dt>Format</dt><dd>{asset.mime_type || "Unknown"}</dd></div><div><dt>Size</dt><dd>{fileSize(asset.file_size)}</dd></div><div><dt>Dimensions</dt><dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "Not recorded"}</dd></div><div><dt>Used</dt><dd>{usage.length} place{usage.length === 1 ? "" : "s"}</dd></div></dl>
                  <div className="usage-map">{releaseUses.length ? releaseUses.map((release) => <Link href={`/studio/releases/${release!.id}?tab=media`} key={release!.id}>{release!.title}</Link>) : <span>Not attached yet</span>}</div>
                  <details className="attach-drawer"><summary>Attach asset</summary><form action={attachMediaAsset}><input type="hidden" name="media_asset_id" value={asset.id} /><Field label="Release"><select name="release_id" required defaultValue=""><option value="" disabled>Choose release</option>{releases.map((release) => <option value={release.id} key={release.id}>{release.title}</option>)}</select></Field><Field label="Role"><select name="role" defaultValue={asset.asset_type}><option value={asset.asset_type}>{asset.asset_type.replaceAll("_", " ")}</option>{asset.asset_type !== "content_video" ? <option value="content_video">content video</option> : null}{asset.asset_type !== "alternate_artwork" ? <option value="alternate_artwork">alternate artwork</option> : null}</select></Field><label className="checkbox-field"><input type="checkbox" name="is_primary" /> Primary for this role</label><Submit>Attach</Submit></form></details>
                </div>
              </article>
            );
          })}
        </section>
      ) : <div className="empty-state"><div className="empty-orbit" /><h3>No assets match this view</h3><p>Clear filters or upload the first intentional asset.</p><a className="button" href="#upload">Upload asset</a></div>}
    </>
  );
}
