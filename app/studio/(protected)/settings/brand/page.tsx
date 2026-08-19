import Link from "next/link";
import { saveBrandProfileV2 } from "@/app/studio/brand-actions-v2";
import { Field, PageHeader, Submit } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";

const defaults = {
  essence: "Atlas Irwin is a retro-futuristic electronic music project rooted in nu-disco, house, electro-funk and soulful electronic pop. Warm, sensual, polished, emotional, playful and futuristic.",
  voice: "Confident, intimate, precise, playful and human. Never corporate, breathless or over-promotional.",
  music: "Late-night Berlin energy, futuristic disco, Rhodes warmth, chrome synth textures, analog glow, movement, dancefloor intimacy and human feeling inside digital tools.",
  visual: "Warm electronic glow, elegant technology, sensual afterhours energy, chrome reflections, analog warmth, subtle surrealism, movement and minimal typography.",
  audience: "Dancefloor listeners, independent DJs, electronic-pop explorers, nu-disco communities and design-aware night people.",
  exclusions: "Cheap cyberpunk, generic sci-fi, robotic clichés, obvious faceless stock-like characters, neon overload and cheap AI gimmick aesthetics.",
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
  const { data, error } = await supabase.from("brand_settings").select("section,content").eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  const stored = new Map((data ?? []).map((row) => [row.section, rowText(row.content)]));

  return (
    <div className="studio-v2-page v2-narrow-page">
      <PageHeader
        title="Brand profile"
        description="Teach Atlas the core taste once. Prompt templates and AI guidance are derived from this profile instead of becoming another set of fields to maintain."
        action={<Link className="button" href="/studio/brand">Advanced brand system</Link>}
      />

      <form action={saveBrandProfileV2} className="studio-form v2-brand-profile">
        <section className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">Identity</span><h2>What should always feel true?</h2></div></div>
          <div className="form-grid">
            <Field label="Brand essence" wide><textarea name="essence" rows={5} required defaultValue={stored.get("Brand essence") || defaults.essence} /></Field>
            <Field label="Voice and tone" wide><textarea name="voice" rows={4} required defaultValue={stored.get("Voice and tone") || defaults.voice} /></Field>
          </div>
        </section>

        <section className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">World</span><h2>What does Atlas sound and look like?</h2></div></div>
          <div className="form-grid">
            <Field label="Music world" wide><textarea name="music" rows={5} required defaultValue={stored.get("Music world") || defaults.music} /></Field>
            <Field label="Visual world" wide><textarea name="visual" rows={5} required defaultValue={stored.get("Visual world") || defaults.visual} /></Field>
            <Field label="Audience" wide><textarea name="audience" rows={4} required defaultValue={stored.get("Audience") || defaults.audience} /></Field>
            <Field label="Never do this" wide><textarea name="exclusions" rows={4} defaultValue={stored.get("Visual exclusions") || defaults.exclusions} /></Field>
          </div>
        </section>

        <div className="studio-smart-defaults">
          <strong>Atlas derives the operational guidance</strong>
          <span>Saving this profile regenerates caption guidance, visual prompt guidance, outreach guidance and AI narrative rules deterministically. No paid model call is required.</span>
        </div>
        <div className="form-actions"><Submit>Save brand profile</Submit></div>
      </form>
    </div>
  );
}
