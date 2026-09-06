/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { redirect } from "next/navigation";
import { buildVisualBrandDraft, activateVisualBrandVersion, saveVisualBrandCalibration } from "@/app/studio/visual-brand-actions";
import { setVisualBrandEvidenceRelationship } from "@/app/studio/visual-brand-evidence-actions";
import { MediaUploader } from "@/components/studio/media-uploader";
import { Field, PageHeader, Submit } from "@/components/studio/ui";
import { loadActiveVisualBrand, loadLatestVisualBrandDraft } from "@/lib/brand/visual-brand-store";
import { parseVisualBrandDna, type VisualBrandAnalysis } from "@/lib/brand/visual-brand-dna";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { mediaMetadata } from "@/lib/studio/media";
import type { Json, MediaAsset } from "@/types/database";

const relationshipCopy = {
  official: ["Already me", "Strong evidence of the artist's established visual identity."],
  inspiration: ["More like this", "A direction to learn from without copying the source literally."],
  experimental: ["Exploring", "A possible future direction with lower weight than established work."],
  avoid: ["Not my style", "Negative evidence that teaches Ensemblis what to keep out."],
} as const;

type Relationship = keyof typeof relationshipCopy;

function evidenceRelationship(asset: MediaAsset): Relationship {
  const tags = new Set(mediaMetadata(asset).tags.map((tag) => tag.toLowerCase()));
  if (tags.has("brand:avoid")) return "avoid";
  if (tags.has("brand:experimental")) return "experimental";
  if (tags.has("brand:inspiration")) return "inspiration";
  return "official";
}

function artistBrandAssets(assets: MediaAsset[], artistId: string) {
  const artistTag = `artist:${artistId}`.toLowerCase();
  return assets.filter((asset) => {
    if (!asset.mime_type?.startsWith("image/") || !asset.public_url) return false;
    if (!["brand_reference", "brand_negative_reference", "brand_logo"].includes(asset.asset_type)) return false;
    return mediaMetadata(asset).tags.map((tag) => tag.toLowerCase()).includes(artistTag);
  });
}

function record(value: Json | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function analysisFrom(value: Json | unknown): VisualBrandAnalysis | null {
  const source = record(value);
  if (typeof source.summary !== "string" || !Array.isArray(source.clusters)) return null;
  return source as unknown as VisualBrandAnalysis;
}

async function buildDraft(form: FormData) {
  "use server";
  await buildVisualBrandDraft(form);
  redirect("/studio/settings/brand/visual?draft=ready");
}

export default async function VisualBrandPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const [active, draft, assetResult] = await Promise.all([
    loadActiveVisualBrand({ db: supabase, ownerId: user.id, artistId: artist.artistId }),
    loadLatestVisualBrandDraft({ db: supabase, ownerId: user.id, artistId: artist.artistId }),
    supabase.from("media_assets").select("*").eq("owner_id", user.id).order("updated_at", { ascending: false }),
  ]);
  if (assetResult.error) throw new Error(assetResult.error.message);
  const assets = artistBrandAssets((assetResult.data ?? []) as MediaAsset[], artist.artistId);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const draftDna = draft ? parseVisualBrandDna(draft.dna) : null;
  const draftAnalysis = draft ? analysisFrom(draft.analysis) : null;
  const evidenceCount = assets.filter((asset) => evidenceRelationship(asset) !== "avoid").length;

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Visual Brand DNA"
        description={`Turn ${artist.artistName}'s real visual history into one reusable identity system for release artwork, social media, video and every future creative generation.`}
        action={<Link className="button" href="/studio/settings/brand">Brand profile</Link>}
      />

      <div className="studio-smart-defaults">
        <strong>References → analysis → calibration → active identity</strong>
        <span>Ensemblis does the visual analysis and fills the system. You only curate the evidence and make the few decisions that require artistic judgment.</span>
      </div>

      {active ? (
        <section className="studio-panel feature">
          <div className="panel-head">
            <div>
              <span className="section-label">Active · v{active.version} · {Math.round(active.confidence * 100)}% evidence confidence</span>
              <h2>{active.dna.thesis}</h2>
              <p>This is the visual source of truth currently injected into Ensemblis creative generation. A new analysis creates a draft version without changing live output until you activate it.</p>
            </div>
          </div>
          <div className="media-tags">{active.dna.personality.map((trait) => <span key={trait}>{trait}</span>)}</div>
          <div className="form-actions"><a className="button" href="#evidence">Evolve from new evidence</a></div>
        </section>
      ) : (
        <section className="studio-panel feature">
          <span className="section-label">No active identity yet</span>
          <h2>Build the visual system once, then let every creative tool use it.</h2>
          <p>Start from finished artwork, photography, posters, visual experiments and a small number of references that genuinely point toward the artist you want to become.</p>
        </section>
      )}

      <section className="studio-panel feature" id="evidence">
        <div className="panel-head">
          <div>
            <span className="section-label">1 · Evidence</span>
            <h2>Show Ensemblis the visual world</h2>
            <p>Upload images first. New brand references start as <strong>Already me</strong>; reclassify any item below as inspiration, experimental or negative evidence.</p>
          </div>
        </div>
        <MediaUploader defaultRole="brand_reference" artistId={artist.artistId} />

        {assets.length ? (
          <div className="media-grid" aria-label={`${artist.artistName} visual brand evidence`}>
            {assets.map((asset) => {
              const metadata = mediaMetadata(asset);
              const current = evidenceRelationship(asset);
              return (
                <article className="media-card" key={asset.id}>
                  <div className="media-thumb"><img src={asset.public_url ?? ""} alt="" /></div>
                  <div className="media-card-body">
                    <span className="section-label">{relationshipCopy[current][0]}</span>
                    <h3>{metadata.title}</h3>
                    <p>{relationshipCopy[current][1]}</p>
                    <form action={setVisualBrandEvidenceRelationship} className="form-actions">
                      <input type="hidden" name="artist_id" value={artist.artistId} />
                      <input type="hidden" name="asset_id" value={asset.id} />
                      {Object.entries(relationshipCopy).map(([relationship, copy]) => (
                        <button
                          type="submit"
                          className={relationship === current ? "button primary" : "button"}
                          name="relationship"
                          value={relationship}
                          key={relationship}
                        >
                          {copy[0]}
                        </button>
                      ))}
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state"><h3>Add at least three strong images</h3><p>Five to twelve varied, representative images usually produce a much stronger identity than a huge uncurated dump.</p></div>
        )}
      </section>

      <section className="studio-panel feature">
        <div className="panel-head">
          <div>
            <span className="section-label">2 · Analyze</span>
            <h2>Find the recurring visual logic</h2>
            <p>Ensemblis compares the strongest evidence, separates core identity from experiments, detects anti-style, and produces the same structured Visual Brand DNA schema for every artist.</p>
          </div>
        </div>
        <form action={buildDraft} className="studio-form">
          <input type="hidden" name="artist_id" value={artist.artistId} />
          <div className="form-grid">
            <Field label="How defined is the identity today?">
              <select name="maturity" defaultValue={active ? "established" : "emerging"}>
                <option value="starting">Starting from fragments</option>
                <option value="emerging">Some recurring ideas</option>
                <option value="established">Already fairly established</option>
              </select>
            </Field>
            <Field label="Primary uses" wide>
              <div className="media-tags">
                {[
                  ["release_artwork", "Release artwork"], ["social", "Social"], ["video", "Video / Reels"],
                  ["artist_profile", "Artist profile"], ["posters", "Posters / flyers"], ["website", "Website"],
                ].map(([value, label]) => <label className="checkbox-field" key={value}><input type="checkbox" name="use_case" value={value} defaultChecked={["release_artwork", "social", "video"].includes(value)} /> {label}</label>)}
              </div>
            </Field>
          </div>
          <div className="studio-smart-defaults">
            <strong>{evidenceCount >= 3 ? `${evidenceCount} usable visual references ready` : `${evidenceCount}/3 minimum usable references`}</strong>
            <span>Avoid references teach exclusions and are not counted toward the minimum positive evidence set.</span>
          </div>
          <div className="form-actions"><Submit disabled={evidenceCount < 3}>{active ? "Build next identity version" : "Analyze & build Visual Brand DNA"}</Submit></div>
        </form>
      </section>

      {draft && draftDna ? (
        <section className="studio-panel feature">
          <div className="panel-head">
            <div>
              <span className="section-label">3 · Calibrate · draft v{draft.version}</span>
              <h2>{draftDna.thesis}</h2>
              <p>{draftAnalysis?.summary || "Ensemblis synthesized a structured visual identity from the selected evidence."}</p>
            </div>
          </div>

          <div className="identity-grid">
            <section className="studio-panel">
              <span className="section-label">Color system</span>
              <div className="media-tags">
                {draftDna.colors.map((color) => <span key={`${color.hex}-${color.name}`} title={color.usage}><i aria-hidden style={{ background: color.hex, display: "inline-block", width: 12, height: 12, borderRadius: 999, marginRight: 6 }} />{color.name}</span>)}
              </div>
            </section>
            <section className="studio-panel">
              <span className="section-label">Signature motifs</span>
              <div className="media-tags">{draftDna.motifs.signature.map((motif) => <span key={motif.name}>{motif.name}</span>)}</div>
            </section>
            <section className="studio-panel">
              <span className="section-label">Texture & material</span>
              <p>{[...draftDna.textures.primary, ...draftDna.materials].join(" · ")}</p>
            </section>
            <section className="studio-panel">
              <span className="section-label">Evidence confidence</span>
              <p>Overall {Math.round(draftDna.fieldConfidence.overall * 100)}% · palette {Math.round(draftDna.fieldConfidence.palette * 100)}% · motifs {Math.round(draftDna.fieldConfidence.motifs * 100)}% · photography {Math.round(draftDna.fieldConfidence.photography * 100)}%</p>
            </section>
          </div>

          {draftAnalysis?.clusters?.length ? (
            <div className="identity-grid">
              {draftAnalysis.clusters.map((cluster) => <section className="studio-panel" key={`${cluster.role}-${cluster.name}`}><span className="section-label">{cluster.role}</span><h3>{cluster.name}</h3><p>{cluster.description}</p></section>)}
            </div>
          ) : null}

          <form action={saveVisualBrandCalibration} className="studio-form">
            <input type="hidden" name="artist_id" value={artist.artistId} />
            <input type="hidden" name="version_id" value={draft.id} />
            <div className="form-grid">
              <Field label="Visual identity thesis" wide><textarea name="thesis" rows={3} defaultValue={draftDna.thesis} /></Field>
              <Field label="Creative freedom (0 = strict, 100 = adventurous)"><input type="number" min="0" max="100" name="creative_freedom" defaultValue={Math.round(draftDna.creativeFreedom * 100)} /></Field>
              <Field label="How often should people appear?"><select name="human_usage" defaultValue={draftDna.humanRepresentation.usage}><option value="none">Never by default</option><option value="rare">Rarely</option><option value="regular">Regularly</option><option value="central">Central to the identity</option></select></Field>
              <Field label="What this brand is not" wide><textarea name="anti_style" rows={5} defaultValue={draftDna.antiStyle.join("\n")} /></Field>
            </div>

            <div className="v2-section-heading"><div><span className="section-label">Canonical references</span><h3>Keep the strongest, diverse identity anchors</h3><p>These are the approved visual anchors saved with this identity version. Keep at least three.</p></div></div>
            <div className="media-grid">
              {draft.source_asset_ids.flatMap((assetId) => {
                const asset = assetById.get(assetId);
                if (!asset?.public_url) return [];
                return [<label className="media-card" key={assetId}><div className="media-thumb"><img src={asset.public_url} alt="" /></div><div className="media-card-body"><span className="checkbox-field"><input type="checkbox" name="canonical_asset_id" value={assetId} defaultChecked={draft.canonical_asset_ids.includes(assetId)} /> Use as canonical reference</span></div></label>];
              })}
            </div>
            <div className="form-actions"><Submit>Save calibration</Submit></div>
          </form>

          <form action={activateVisualBrandVersion} className="studio-form">
            <input type="hidden" name="artist_id" value={artist.artistId} />
            <input type="hidden" name="version_id" value={draft.id} />
            <div className="studio-smart-defaults"><strong>4 · Activate</strong><span>Activation makes this version the visual SSOT and automatically refreshes compatibility guidance used by existing Ensemblis creative workflows.</span></div>
            <div className="form-actions"><Submit>Activate Visual Brand DNA v{draft.version}</Submit></div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
