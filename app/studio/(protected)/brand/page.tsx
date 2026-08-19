/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { deleteStudioRecord, saveBrandSetting } from "@/app/studio/actions";
import { MediaUploader } from "@/components/studio/media-uploader";
import { Field, PageHeader, Submit } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { mediaMetadata, mediaTypeLabel } from "@/lib/studio/media";

const seed: Record<string, string> = {
  "Brand essence":
    "Atlas Irwin is a retro-futuristic electronic music project rooted in nu-disco, house, electro-funk, and soulful electronic pop. The project feels warm, sensual, polished, emotional, sophisticated, playful, and futuristic.",
  "Voice and tone":
    "Confident, intimate, precise, playful, human. Never corporate or breathlessly promotional.",
  "Music world":
    "Late-night Berlin energy, futuristic disco, Rhodes warmth, chrome synth textures, analog glow, movement, dancefloor intimacy, and human feeling inside digital tools.",
  "Visual world":
    "Warm electronic glow, elegant technology, sensual afterhours energy, chrome reflections, analog warmth, subtle surrealism, movement, and minimal typography. The look should feel designed and collected over time, not regenerated from scratch for every post.",
  "Visual continuity rules":
    "Treat approved Atlas Irwin brand references and the current release artwork as hard art-direction anchors. New work should extend their palette, materials, geometry, lighting logic and emotional temperature. Release artwork outranks generic brand references for release campaigns. Do not invent a new visual identity per post. Preserve exact logos through deterministic placement rather than asking an image model to redraw them.",
  Audience:
    "Dancefloor listeners, independent DJs, electronic-pop explorers, nu-disco communities, and design-aware night people.",
  "Approved phrases":
    "Human feeling inside digital tools; made for the second wind; warm circuitry; movement as release.",
  "Words to avoid":
    "Revolutionary, game-changing, generated, content hack, viral, futuristic vibes.",
  "AI narrative guidance":
    "AI can be present as part of the creative language, but never as a gimmick or the central selling point. Human instinct, taste, direction, curation, songwriting, visual identity, and artistic intention remain central.",
  "Visual exclusions":
    "Cheap cyberpunk, generic sci-fi, robotic clichés, obvious faceless stock-like characters, neon overload, plastic materials, impossible glossy perfection, meaningless pseudo-typography, and cheap AI gimmick aesthetics.",
  "Preferred content formats":
    "Short performance fragments; tactile process clips; mood films; DJ-oriented cuts; emotional context; community questions.",
  "CTA library":
    "Listen when the room goes quiet. Save this for later. Send this to someone who moves like this. Which second caught you?",
  "Caption templates":
    "[Emotional truth] + [specific musical or visual detail] + [one quiet invitation].",
  "Visual prompt templates":
    "Vertical 9:16, retro-futuristic, warm electronic glow, elegant technology, Berlin afterhours, futuristic disco, chrome reflections, analog warmth, subtle surrealism, movement; minimal typography.",
  "Outreach message templates":
    "Hi [name] - I’m sharing [release], a warm late-night electronic release built for movement. I thought it might fit your world. Happy to send a private link and context if useful.",
};

export default async function BrandPage() {
  const { supabase, user } = await requireStudioAdmin();
  const [settingsResult, assetsResult] = await Promise.all([
    supabase.from("brand_settings").select("*").eq("owner_id", user.id),
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
  const brandAssets = (assetsResult.data ?? []).filter((asset) =>
    ["brand_reference", "brand_logo", "brand_motion_reference"].includes(asset.asset_type),
  );

  return (
    <>
      <PageHeader
        title="Brand system"
        description="The reusable creative guardrails and reference media behind every Atlas Irwin release, campaign and generated asset."
        action={<Link className="button" href="/studio/media">Open full Media Library</Link>}
      />

      <section className="studio-panel feature">
        <div className="panel-head">
          <div>
            <span className="section-label">Visual source of truth</span>
            <h2>Atlas Irwin reference media</h2>
            <p>Upload finished artwork, identity studies, texture references, photography, motion language or logos that genuinely represent Atlas Irwin. The Creative Engine automatically ranks these against each release and sends the strongest references directly to the generation model.</p>
          </div>
        </div>
        <div className="studio-smart-defaults">
          <strong>Reference hierarchy is automatic</strong>
          <span>For a release campaign, its primary artwork wins first, then alternate release artwork, then approved Atlas Irwin visual references. Logos are identity evidence only and are not asked to be redrawn by generative models.</span>
        </div>
        <MediaUploader defaultRole="brand_reference" />
        {brandAssets.length ? (
          <div className="media-grid" aria-label="Atlas Irwin brand references">
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
                    {metadata.tags.length ? <div className="media-tags">{metadata.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state"><h3>No brand reference media yet</h3><p>The text rules still apply, but adding a few strong visual references will make AI generations materially more cohesive.</p></div>
        )}
      </section>

      <div className="identity-grid">
        {Object.entries(seed).map(([section, defaultText]) => (
          <section className="studio-panel feature" key={section}>
            <form action={saveBrandSetting} className="studio-form">
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
              <form action={deleteStudioRecord}>
                <input type="hidden" name="id" value={storedIds.get(section)} />
                <input type="hidden" name="table" value="brand_settings" />
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
