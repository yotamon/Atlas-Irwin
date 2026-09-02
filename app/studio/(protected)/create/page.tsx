import Link from "next/link";
import { PageHeader, Panel } from "@/components/studio/ui";

const primaryOutcomes = [
  {
    title: "Move Atlas forward",
    eyebrow: "Recommended",
    description:
      "Start from the highest-leverage decision. Today already knows what is blocked, what Atlas is preparing and which release needs attention.",
    href: "/studio",
    cta: "Open Today",
  },
  {
    title: "Start a release",
    eyebrow: "New release",
    description:
      "Create the minimum release workspace. Atlas will classify its lifecycle and build only the work that is still actionable.",
    href: "/studio/releases/new",
    cta: "Create release",
  },
  {
    title: "Develop new music",
    eyebrow: "Artist-led creation",
    description:
      "Use Music Lab when the goal is making a new track, not when a campaign simply needs another asset.",
    href: "/studio/music",
    cta: "Open Music Lab",
  },
];

export default function CreatePage() {
  return (
    <>
      <PageHeader
        title="Create"
        description="Start with the outcome. Atlas chooses campaign machinery automatically; specialist tools stay available when you deliberately want to direct the craft."
      />
      <div className="v2-create-grid">
        {primaryOutcomes.map((item) => (
          <Link className="v2-create-card" href={item.href} key={item.title}>
            <span className="section-label">{item.eyebrow}</span>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
            <strong>{item.cta} →</strong>
          </Link>
        ))}
      </div>
      <details className="v2-advanced-disclosure">
        <summary>Direct a specialist production tool</summary>
        <Panel title="Use these when you want to override or deepen the normal release workflow.">
          <div className="v2-secondary-links">
            <Link href="/studio/production">Production queue</Link>
            <Link href="/studio/video">Video Director</Link>
            <Link href="/studio/campaigns">Campaign Brain</Link>
            <Link href="/studio/outreach">Outreach</Link>
            <Link href="/studio/content">Legacy Content Lab</Link>
          </div>
        </Panel>
      </details>
    </>
  );
}
