import { deleteStudioRecord, saveBrandSetting } from "@/app/studio/actions";
import { Field, PageHeader, Submit } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
const seed: Record<string, string> = {
  "Brand essence":
    "Atlas Irwin is a retro-futuristic electronic music project rooted in nu-disco, house, electro-funk, and soulful electronic pop. The project feels warm, sensual, polished, emotional, sophisticated, playful, and futuristic.",
  "Voice and tone":
    "Confident, intimate, precise, playful, human. Never corporate or breathlessly promotional.",
  "Music world":
    "Late-night Berlin energy, futuristic disco, Rhodes warmth, chrome synth textures, analog glow, movement, dancefloor intimacy, and human feeling inside digital tools.",
  "Visual world":
    "Warm electronic glow, elegant technology, sensual afterhours energy, chrome reflections, analog warmth, subtle surrealism, movement, and minimal typography.",
  Audience:
    "Dancefloor listeners, independent DJs, electronic-pop explorers, nu-disco communities, and design-aware night people.",
  "Approved phrases":
    "Human feeling inside digital tools; made for the second wind; warm circuitry; movement as release.",
  "Words to avoid":
    "Revolutionary, game-changing, generated, content hack, viral, futuristic vibes.",
  "AI narrative guidance":
    "AI can be present as part of the creative language, but never as a gimmick or the central selling point. Human instinct, taste, direction, curation, songwriting, visual identity, and artistic intention remain central.",
  "Visual exclusions":
    "Cheap cyberpunk, generic sci-fi, robotic clichés, obvious faceless stock-like characters, neon overload, and cheap AI gimmick aesthetics.",
  "Preferred content formats":
    "Short performance fragments; tactile process clips; mood films; DJ-oriented cuts; emotional context; community questions.",
  "CTA library":
    "Listen when the room goes quiet. Save this for later. Send this to someone who moves like this. Which second caught you?",
  "Caption templates":
    "[Emotional truth] + [specific musical or visual detail] + [one quiet invitation].",
  "Visual prompt templates":
    "Vertical 9:16, retro-futuristic, warm electronic glow, elegant technology, Berlin afterhours, futuristic disco, chrome reflections, analog warmth, subtle surrealism, movement; minimal typography.",
  "Outreach message templates":
    "Hi [name] — I’m sharing [release], a warm late-night electronic release built for movement. I thought it might fit your world. Happy to send a private link and context if useful.",
};
export default async function BrandPage() {
  const { supabase } = await requireStudioAdmin();
  const { data } = await supabase.from("brand_settings").select("*");
  const stored = new Map(
    (data ?? []).map((x) => [
      x.section,
      (x.content as { text?: string })?.text ?? "",
    ]),
  );
  const storedIds = new Map((data ?? []).map((x) => [x.section, x.id]));
  return (
    <>
      <PageHeader
        title="Brand system"
        description="The reusable creative guardrails behind every release and message."
      />
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
