import Link from "next/link";
import { saveBrandProfileV2 } from "@/app/studio/brand-actions-v2";
import { Field, PageHeader, Submit } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";

const defaults = {
  essence: "Define the emotional and artistic truth that should remain recognizable across this artist's releases.",
  voice: "Confident, intimate, precise, human. Never corporate, breathless or over-promotional.",
  music: "Describe the artist's recurring sonic world, energy, references, instrumentation and emotional temperature.",
  visual: "Describe the materials, light, composition, movement, typography and visual atmosphere that should feel native to this artist.",
  audience: "Describe the listeners, scenes, communities and contexts this artist genuinely belongs in.",
  exclusions: "Avoid generic AI aesthetics, visual clichés, fake popularity signals, template-like promotion and anything that conflicts with the artist's established world.",
};

function rowText(content: unknown) {
  if (content && typeof content === "object" && !Array.isArray(content) && "text" in content) {
    const value = (content as { text?: unknown }).text;
    return typeof value === "string" ? value : "";
  }
  return "";
}

export default async function BrandProfilePage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const operational = asArtistScopedOperationalClient(supabase);
  const { data, error } = await operational.from("brand_settings")
    .select("section,content")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId);
  if (error) throw new Error(error.message);
  const stored = new Map((data ?? []).map((row) => [row.section, rowText(row.content)]));

  return (
    <div className="studio-v2-page v2-narrow-page">
      <PageHeader
        title="Brand profile"
        description={`Teach Ensemblis the core taste of ${artist.artistName} once. Prompt guidance is derived from this artist profile instead of becoming another set of fields to maintain.`}
        action={<Link className="button" href="/studio/brand">Advanced brand system</Link>}
      />

      <form action={saveBrandProfileV2} className="studio-form v2-brand-profile">
        <input type="hidden" name="artist_id" value={artist.artistId} />
        <section className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">Identity</span><h2>What should always feel true?</h2></div></div>
          <div className="form-grid">
            <Field label="Brand essence" wide><textarea name="essence" rows={5} required defaultValue={stored.get("Brand essence") || defaults.essence} /></Field>
            <Field label="Voice and tone" wide><textarea name="voice" rows={4} required defaultValue={stored.get("Voice and tone") || defaults.voice} /></Field>
          </div>
        </section>

        <section className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">World</span><h2>What does this artist sound and look like?</h2></div></div>
          <div className="form-grid">
            <Field label="Music world" wide><textarea name="music" rows={5} required defaultValue={stored.get("Music world") || defaults.music} /></Field>
            <Field label="Visual world" wide><textarea name="visual" rows={5} required defaultValue={stored.get("Visual world") || defaults.visual} /></Field>
            <Field label="Audience" wide><textarea name="audience" rows={4} required defaultValue={stored.get("Audience") || defaults.audience} /></Field>
            <Field label="Never do this" wide><textarea name="exclusions" rows={4} defaultValue={stored.get("Visual exclusions") || defaults.exclusions} /></Field>
          </div>
        </section>

        <div className="studio-smart-defaults">
          <strong>Ensemblis derives the operational guidance</strong>
          <span>Saving this profile regenerates caption guidance, visual prompt guidance, outreach guidance and AI narrative rules deterministically for this artist. No paid model call is required.</span>
        </div>
        <div className="form-actions"><Submit>Save brand profile</Submit></div>
      </form>
    </div>
  );
}
