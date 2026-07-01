/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import {
  attachMediaAsset,
  deleteMediaAsset,
  detachMediaAsset,
  updateMediaAsset,
  updateMediaLink,
} from "@/app/studio/catalog-actions";
import { MediaUploader } from "@/components/studio/media-uploader";
import { ConfirmButton } from "@/components/studio/submit-button";
import { Field, PageHeader, Submit } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  compatibleMediaTypes,
  MEDIA_TYPES,
  mediaKind,
  mediaMetadata,
  mediaTypeLabel,
} from "@/lib/studio/media";
import { createMediaPreviewMap } from "@/lib/studio/media-previews";
import type { MediaAsset } from "@/types/database";

function fileSize(value: number | null) {
  if (!value) return "Size unavailable";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

function duration(value: number | null) {
  if (!value) return null;
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function MediaPreview({ asset, url }: { asset: MediaAsset; url?: string }) {
  if (!url) return <span className="media-file-placeholder">{mediaTypeLabel(asset.asset_type)}</span>;
  if (asset.mime_type?.startsWith("image/")) return <img src={url} alt="" />;
  if (asset.mime_type?.startsWith("video/")) return <video src={url} muted playsInline controls preload="metadata" />;
  if (asset.mime_type?.startsWith("audio/")) return <div className="media-audio-preview"><span>{mediaTypeLabel(asset.asset_type)}</span><audio src={url} controls preload="metadata" /></div>;
  return <span className="media-file-placeholder">{asset.mime_type === "application/zip" ? "ZIP production file" : "Stored file"}</span>;
}

type SearchParams = {
  q?: string;
  type?: string;
  view?: string;
  sort?: string;
  tag?: string;
  upload?: string;
};

export default async function MediaLibraryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const [assetsResult, linksResult, releasesResult] = await Promise.all([
    supabase.from("media_assets").select("*").eq("owner_id", user.id).order("created_at", { ascending: params.sort !== "oldest" }),
    supabase.from("media_links").select("*").eq("owner_id", user.id),
    supabase.from("releases").select("id,title").eq("owner_id", user.id).order("title"),
  ]);
  if (assetsResult.error) throw new Error(assetsResult.error.message);
  if (linksResult.error) throw new Error(linksResult.error.message);
  if (releasesResult.error) throw new Error(releasesResult.error.message);
  const links = linksResult.data ?? [];
  const releases = releasesResult.data ?? [];
  const releaseById = new Map(releases.map((release) => [release.id, release]));
  const allAssets = (assetsResult.data ?? []) as MediaAsset[];
  const previewUrls = await createMediaPreviewMap(supabase, allAssets);
  const tagCounts = new Map<string, number>();
  allAssets.forEach((asset) => mediaMetadata(asset).tags.forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)));
  const popularTags = [...tagCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);

  let assets = [...allAssets];
  if (params.type) assets = assets.filter((asset) => asset.asset_type === params.type);
  if (params.tag) assets = assets.filter((asset) => mediaMetadata(asset).tags.includes(params.tag!));
  if (params.q) {
    const query = params.q.toLowerCase();
    assets = assets.filter((asset) => {
      const metadata = mediaMetadata(asset);
      return `${metadata.title} ${metadata.originalName} ${metadata.description} ${metadata.tags.join(" ")} ${asset.asset_type} ${asset.mime_type}`.toLowerCase().includes(query);
    });
  }
  if (params.sort === "used") assets.sort((a, b) => links.filter((link) => link.media_asset_id === b.id).length - links.filter((link) => link.media_asset_id === a.id).length);
  if (params.sort === "type") assets.sort((a, b) => a.asset_type.localeCompare(b.asset_type));
  if (params.sort === "name") assets.sort((a, b) => mediaMetadata(a).title.localeCompare(mediaMetadata(b).title));
  const usedAssets = new Set(links.map((link) => link.media_asset_id));

  return (
    <>
      <PageHeader
        title="Media Library"
        description="Upload once, describe it clearly, and reuse it everywhere. This is the source of truth for artwork, motion, audio, campaign media, and future creative references."
        action={<a className="button primary" href="#upload">Add media</a>}
      />

      <section className="media-overview" aria-label="Library summary">
        <div><strong>{allAssets.length}</strong><span>Total assets</span></div>
        <div><strong>{usedAssets.size}</strong><span>In use</span></div>
        <div><strong>{allAssets.length - usedAssets.size}</strong><span>Ready to assign</span></div>
      </section>

      <details className="upload-drawer media-upload-drawer" id="upload" open={params.upload === "1" || !allAssets.length}>
        <summary><span><strong>Add media</strong><small>Upload several files, tag them together, then assign them whenever you need them.</small></span></summary>
        <MediaUploader />
      </details>

      <section className="media-toolbar" aria-label="Media filters">
        <form className="media-search">
          <input name="q" defaultValue={params.q} placeholder="Search name, tag, notes, or format" aria-label="Search media" />
          <select name="type" defaultValue={params.type ?? ""} aria-label="Filter by media type"><option value="">All uses</option>{MEDIA_TYPES.map((type) => <option value={type} key={type}>{mediaTypeLabel(type)}</option>)}</select>
          <select name="sort" defaultValue={params.sort ?? "recent"} aria-label="Sort media"><option value="recent">Recently added</option><option value="oldest">Oldest first</option><option value="used">Most used</option><option value="name">Name</option><option value="type">Media use</option></select>
          <button className="button">Apply</button>
          {(params.q || params.type || params.tag || params.sort) ? <Link className="text-button media-clear" href="/studio/media">Clear</Link> : null}
        </form>
        <div className="view-toggle"><Link className={params.view !== "list" ? "active" : undefined} href={{ query: { ...params, view: "grid" } }}>Grid</Link><Link className={params.view === "list" ? "active" : undefined} href={{ query: { ...params, view: "list" } }}>List</Link></div>
      </section>

      {popularTags.length ? <nav className="media-tag-filter" aria-label="Popular tags"><span>Tags</span>{popularTags.map(([tag, count]) => <Link className={params.tag === tag ? "active" : undefined} href={{ query: { ...params, tag: params.tag === tag ? undefined : tag } }} key={tag}>{tag}<small>{count}</small></Link>)}</nav> : null}

      {assets.length ? (
        <section className={params.view === "list" ? "media-list" : "media-grid"} aria-label={`${assets.length} media assets`}>
          {assets.map((asset) => {
            const metadata = mediaMetadata(asset);
            const usage = links.filter((link) => link.media_asset_id === asset.id);
            const roleOptions = compatibleMediaTypes(asset.mime_type);
            return (
              <article className="media-card" key={asset.id}>
                <div className="media-thumb">
                  <MediaPreview asset={asset} url={previewUrls[asset.id]} />
                  <span className="media-kind">{mediaKind(asset.mime_type)}</span>
                </div>
                <div className="media-card-body">
                  <div className="media-card-title"><span className="section-label">{mediaTypeLabel(asset.asset_type)}</span><h2>{metadata.title}</h2><small>{metadata.originalName}</small></div>
                  {metadata.description ? <p className="media-description">{metadata.description}</p> : null}
                  {metadata.tags.length ? <div className="media-tags">{metadata.tags.map((tag) => <Link href={{ query: { tag } }} key={tag}>{tag}</Link>)}</div> : <div className="media-tags empty">No tags yet</div>}
                  <dl className="asset-meta">
                    <div><dt>Format</dt><dd>{asset.mime_type?.split("/").at(-1)?.toUpperCase() || "Unknown"}</dd></div>
                    <div><dt>Size</dt><dd>{fileSize(asset.file_size)}</dd></div>
                    <div><dt>Media info</dt><dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : duration(asset.duration_ms) || "Not recorded"}</dd></div>
                    <div><dt>Used</dt><dd>{usage.length} place{usage.length === 1 ? "" : "s"}</dd></div>
                  </dl>

                  {usage.length ? <div className="media-assignments">{usage.map((link) => {
                    const release = link.release_id ? releaseById.get(link.release_id) : null;
                    return <details key={link.id}><summary><span>{release ? release.title : link.track_id ? "Track assignment" : "Campaign assignment"}</span><small>{mediaTypeLabel(link.role)}{link.is_primary ? " · Primary" : ""}</small></summary><form action={updateMediaLink} className="compact-media-form"><input type="hidden" name="media_link_id" value={link.id} /><Field label="Role"><select name="role" defaultValue={link.role}>{roleOptions.map((role) => <option value={role} key={role}>{mediaTypeLabel(role)}</option>)}</select></Field><Field label="Alt text"><input name="alt_text" defaultValue={link.alt_text ?? ""} /></Field><Field label="Caption"><input name="caption" defaultValue={link.caption ?? ""} /></Field><label className="checkbox-field"><input type="checkbox" name="is_primary" defaultChecked={link.is_primary} /> Primary for this role</label><div className="inline-actions"><Submit>Save assignment</Submit>{release ? <Link className="button" href={`/studio/releases/${release.id}?tab=media`}>Open release</Link> : null}</div></form><form action={detachMediaAsset}><input type="hidden" name="media_link_id" value={link.id} /><ConfirmButton message={`Detach ${metadata.title} from this use?`}>Detach from this use</ConfirmButton></form></details>;
                  })}</div> : <p className="unused-note">Not used yet — ready to assign.</p>}

                  <details className="attach-drawer"><summary>Use in a release</summary><form action={attachMediaAsset}><input type="hidden" name="media_asset_id" value={asset.id} /><Field label="Release"><select name="release_id" required defaultValue=""><option value="" disabled>Choose release</option>{releases.map((release) => <option value={release.id} key={release.id}>{release.title}</option>)}</select></Field><Field label="Role"><select name="role" defaultValue={roleOptions.includes(asset.asset_type as never) ? asset.asset_type : roleOptions[0]}>{roleOptions.map((role) => <option value={role} key={role}>{mediaTypeLabel(role)}</option>)}</select></Field><Field label="Alt text"><input name="alt_text" placeholder="Describe the media when it carries meaning" /></Field><label className="checkbox-field"><input type="checkbox" name="is_primary" /> Primary for this role</label><Submit>Assign media</Submit></form></details>

                  <details className="asset-settings"><summary>Edit details</summary><form action={updateMediaAsset} className="studio-form"><input type="hidden" name="media_asset_id" value={asset.id} /><div className="form-grid"><Field label="Display name"><input name="title" defaultValue={metadata.title} /></Field><Field label="Media use"><select name="asset_type" defaultValue={asset.asset_type}>{roleOptions.map((role) => <option value={role} key={role}>{mediaTypeLabel(role)}</option>)}</select></Field><Field label="Tags"><input name="tags" defaultValue={metadata.tags.join(", ")} /></Field><Field label="Notes" wide><textarea name="description" rows={3} defaultValue={metadata.description} /></Field></div><Submit>Save details</Submit></form><div className="asset-danger"><p>{usage.length ? `Used in ${usage.length} place${usage.length === 1 ? "" : "s"}. Detach every use before deleting.` : "This permanently removes the stored file."}</p><form action={deleteMediaAsset}><input type="hidden" name="media_asset_id" value={asset.id} /><ConfirmButton disabled={Boolean(usage.length)} message={`Permanently delete ${metadata.title}? This cannot be undone.`}>Delete asset</ConfirmButton></form></div></details>
                </div>
              </article>
            );
          })}
        </section>
      ) : <div className="empty-state"><div className="empty-orbit" /><h3>No assets match this view</h3><p>Clear the filters or add media with descriptive tags so it is easy to find later.</p><Link className="button" href="/studio/media">Clear filters</Link></div>}
    </>
  );
}
