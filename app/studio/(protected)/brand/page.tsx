/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { deleteArtistBrandSetting, saveArtistBrandSetting } from "@/app/studio/brand-setting-actions";
import { MediaUploader } from "@/components/studio/media-uploader";
import { Field, PageHeader, Submit } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import { mediaMetadata, mediaTypeLabel } from "@/lib/studio/media";

const seed: Record<string, string> = {
  "Brand essence":
    "Describe the emotional and artistic truth that should remain recognizable across this artist's releases, campaigns and public presence.",
  "Voice and tone":
    "Confident, specific, human and consistent with the artist. Avoid generic promotional language and exaggerated claims.",
  "Music world":
    "Describe the recurring sonic world, energy, references, instrumentation, production character and emotional temperature that define this artist.",
  "Visual world":
    "Describe the materials, light, composition, movement, typography, photography and visual atmosphere that should feel native to this artist. The look should feel designed and collected over time, not regenerated from scratch for every post.",
  "Visual continuity rules":
    "Treat approved artist references and the current release artwork as hard art-direction anchors. Release artwork outranks general references for release campaigns. Preserve exact logos through deterministic placement rather than asking an image model to redraw them.",
  Audience:
    "Describe the listeners, scenes, communities, contexts and cultural spaces this artist genuinely belongs in.",
  "Approved phrases":
    "Add phrases, recurring ideas or language that genuinely sounds like this artist.",
  "Words to avoid":
    "Revolutionary, game-changing, generated, content hack, viral, and any language that feels unlike the artist.",
  "AI narrative guidance":
    "AI may be used as a production tool, but it should never replace artistic intention, taste, direction, curation, songwriting or authorship in the public narrative.",
  "Visual exclusions":
    "Avoid generic AI aesthetics, visual clichés, fake popularity signals, meaningless spectacle, broken typography, synthetic stock-like people and anything that conflicts with the artist's established visual world.",
  "Preferred content formats":
    "List the content formats that best express this artist: performance fragments, process clips, mood films, visualizers, DJ cuts, lyric moments, conversations, community prompts or other recurring formats.",
  "CTA library":
    "Add quiet, artist-appropriate invitations that do not sound like generic growth marketing.",
  "Caption templates":
    "[Specific emotional or musical truth] + [one concrete release detail] + [one quiet invitation].",
  "Visual prompt templates":
    "Describe scene, material, light, camera, movement and continuity from the artist's established visual world. Avoid style-buzzword stacking and never ask the model to render final logos or promotional typography.",
  "Outreach message templates":
    "Hi [name] - I’m sharing [release] because [specific reason it may fit their world]. Happy to send a private link and context if useful.",
};

export default async function BrandPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const operational = asArtistScopedOperationalClient(supabase);
  const [settingsResult, assetsResult] = await Promise.all([
    operational.from("brand_settings").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    supabase.from("media_assets").select("*").eq("owner_id", user.id).order("updated_at", { ascending: false }),
  ]);
  if (settingsResult.error) throw new Error(settingsResult.error.message);
  if (assetsResult.error) throw new Error(assetsResult.error.message);
  const data = settingsResult.data ?? [];
  const stored = new Map(
    data.map((x) => [
      x.section,
      (x.content as { text?: string })?.text ?? "",
    ]),
  );
  const storedIds = new Map(data.map((x) => [x.section, x.id]));
  const artistTag = `artist:${artist.artistId}`.toLowerCase();
  const brandAssets = (assetsResult.data ?? []).filter((asset) => {
    if (!["brand_reference", "brand_logo", "brand_motion_reference"].includes(asset.asset_type)) return false;
    return mediaMetadata(asset).tags.map((tag) => tag.toLowerCase()).includes(artistTag);
  });

  return (
    <>
      <PageHeader
        title="Brand system"
        description={`The reusable creative guardrails and reference media behind every ${artist.artistName} release, campaign and generated asset.`}
        action={<Link className="button" href="/studio/media">Open full Media Library</Link>}
      />

      <section className="studio-panel feature">
        <div className="panel-head">
          <div>
            <span className="section-label">Visual source of truth</span>
            <h2>{artist.artistName} reference media</h2>
            <p>Upload finished artwork, identity studies, texture references, photography, motion language or logos that genuinely represent this artist. Ensemblis tags these references to the active artist so sibling artist workspaces cannot inherit them accidentally.</p>
          </div>
        </div>
        <div className="studio-smart-defaults">
          <strong>Reference hierarchy is automatic</strong>
          <span>For a release campaign, its primary artwork wins first, then alternate release artwork, then approved references tagged to {artist.artistName}. Logos are identity evidence only and are not asked to be redrawn by generative models.</span>
        </div>
        <MediaUploader defaultRole="brand_reference" artistId={artist.artistId} />
        {brandAssets.length ? (
          <div className="media-grid" aria-label={`${artist.artistName} brand references`}>
            {brandAssets.map((asset) => {
              const metadata = mediaMetadata(asset);
              return (
                <article className="media-card" key={asset.id}>
                  <div className="media-thumb">
                    {asset.mime_type?.startsWith("image/") && asset.public_url ? <img src={asset.public_url} alt="" /> : null}
                    {asset.mime_type?.startsWith("video/") && asset.public_url ? <video src={asset.public_url} muted playsInline controls preload="metadata" /> : null}
                  </div>
                  <div className="media-card-body">
                    <span className="section-label">{mediaTypeLabel(asset.asset_type)}</span>
                    <h3>{metadata.title}</h3>
                    {metadata.description ? <p>{metadata.description}</p> : null}
                    {metadata.tags.length ? <div className="media-tags">{metadata.tags.filter((tag) => tag.toLowerCase() !== artistTag).map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state"><h3>No artist-specific brand reference media yet</h3><p>The text rules still apply. Add a few strong visual references here before paid generation so Ensemblis has explicit artist-local evidence.</p></div>
        )}
      </section>

      <div className="identity-grid">
        {Object.entries(seed).map(([section, defaultText]) => (
          <section className="studio-panel feature" key={section}>
            <form action={saveArtistBrandSetting} className="studio-form">
              <input type="hidden" name="artist_id" value={artist.artistId} />
              <input type="hidden" name="section" value={section} />
              <Field label={section} wide>
                <textarea
                  name="content"
                  rows={section.includes("template") ? 6 : 4}
                  defaultValue={stored.get(section) || defaultText}
                />
              </Field>
              <Submit>Save section</Submit>
            </form>
            {storedIds.get(section) ? (
              <form action={deleteArtistBrandSetting}>
                <input type="hidden" name="artist_id" value={artist.artistId} />
                <input type="hidden" name="id" value={storedIds.get(section)} />
                <button className="text-button">
                  Reset to seeded guidance
                </button>
              </form>
            ) : null}
          </section>
        ))}
      </div>
    </>
  );
}
