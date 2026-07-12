import { deleteStudioRecord, saveBrandSetting } from "@/app/studio/actions";
import { Field, PageHeader, Submit } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { BRAND_SEED } from "@/lib/studio/constants";

function firstLine(value: string) {
  return value.split(/[;\n]/)[0]?.trim() || value.trim();
}

function previewCaption(brand: Record<string, string>) {
  const voice = firstLine(brand["Voice and tone"] || BRAND_SEED["Voice and tone"]);
  const phrase = firstLine(brand["Approved phrases"] || BRAND_SEED["Approved phrases"]);
  const template =
    brand["Caption templates"] || BRAND_SEED["Caption templates"];
  const cta = firstLine(brand["CTA library"] || BRAND_SEED["CTA library"]);
  return {
    caption: template
      .replace("[Emotional truth]", phrase)
      .replace(
        "[specific musical or visual detail]",
        firstLine(brand["Music world"] || BRAND_SEED["Music world"]),
      )
      .replace("[one quiet invitation]", cta),
    voice,
    visual: firstLine(
      brand["Visual prompt templates"] || BRAND_SEED["Visual prompt templates"],
    ),
    outreach: (
      brand["Outreach message templates"] ||
      BRAND_SEED["Outreach message templates"]
    )
      .replace("[name]", "Alex")
      .replace("[release]", "Night Circuit"),
  };
}

export default async function BrandPage() {
  const { supabase, user } = await requireStudioAdmin();
  const { data } = await supabase
    .from("brand_settings")
    .select("*")
    .eq("owner_id", user.id);
  const stored = new Map(
    (data ?? []).map((x) => [
      x.section,
      (x.content as { text?: string })?.text ?? "",
    ]),
  );
  const storedIds = new Map((data ?? []).map((x) => [x.section, x.id]));
  const resolved = Object.fromEntries(
    Object.entries(BRAND_SEED).map(([section, defaultText]) => [
      section,
      stored.get(section) || defaultText,
    ]),
  );
  const preview = previewCaption(resolved);

  return (
    <>
      <PageHeader
        title="Brand system"
        description="The reusable creative guardrails behind every release and message."
      />

      <section className="studio-panel feature brand-preview" aria-label="Generation preview">
        <div className="panel-head">
          <h2>Live preview</h2>
          <span className="section-label">How guardrails shape output</span>
        </div>
        <div className="brand-preview-grid">
          <article>
            <span className="section-label">Caption</span>
            <p>{preview.caption}</p>
          </article>
          <article>
            <span className="section-label">Voice check</span>
            <p>{preview.voice}</p>
          </article>
          <article>
            <span className="section-label">Visual prompt</span>
            <p>{preview.visual}</p>
          </article>
          <article>
            <span className="section-label">Outreach opener</span>
            <p>{preview.outreach}</p>
          </article>
        </div>
      </section>

      <div className="identity-grid">
        {Object.entries(BRAND_SEED).map(([section, defaultText]) => (
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
