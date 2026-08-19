import Link from "next/link";
import { PageHeader } from "@/components/studio/ui";

const primary = [
  {
    href: "/studio/releases/new",
    eyebrow: "Start here",
    title: "New release",
    body: "Create the release workspace from just a title, format and date. Atlas builds the operational plan around it.",
    action: "Create workspace",
  },
  {
    href: "/studio/music",
    eyebrow: "Generate",
    title: "Music",
    body: "Develop track ideas with provider and cost controls kept explicit before any paid generation.",
    action: "Open Music Lab",
  },
  {
    href: "/studio/content",
    eyebrow: "Produce",
    title: "Content",
    body: "Open the production queue when you want to refine a specific social asset or creative draft.",
    action: "Open content queue",
  },
] as const;

export default function CreatePage() {
  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Create"
        description="Choose an outcome. The detailed machinery stays out of the way until you need it."
      />

      <section className="v2-create-grid">
        {primary.map((item) => (
          <Link className="v2-create-card" href={item.href} key={item.href}>
            <span className="section-label">{item.eyebrow}</span>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
            <strong>{item.action} <span aria-hidden>→</span></strong>
          </Link>
        ))}
      </section>

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Advanced</span>
            <h2>Build the machinery manually</h2>
          </div>
        </div>
        <p className="v2-muted-copy">
          Campaign Brain and the legacy content tools remain available for exceptional cases, debugging and migrations.
          They are no longer the normal way to operate Atlas.
        </p>
        <div className="actions">
          <Link className="button" href="/studio/campaigns">Campaign Brain</Link>
          <Link className="button" href="/studio/outreach">Outreach workspace</Link>
        </div>
      </section>
    </div>
  );
}
