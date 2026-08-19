import Link from "next/link";
import { PageHeader, Panel } from "@/components/studio/ui";

const createOptions = [
  {
    title: "New Release",
    eyebrow: "Start here",
    description:
      "Give Atlas the minimum viable brief. The Studio will build the workspace around it.",
    href: "/studio/releases/new",
    cta: "Start a release",
  },
  {
    title: "Music",
    eyebrow: "Specialist tool",
    description:
      "Write or generate new material in Music Lab when the job is musical creation.",
    href: "/studio/music",
    cta: "Open Music Lab",
  },
  {
    title: "Content",
    eyebrow: "Production",
    description:
      "Finish the content moments Atlas planned for your releases without managing status fields manually.",
    href: "/studio/production",
    cta: "Open Production",
  },
  {
    title: "Video",
    eyebrow: "Video Director",
    description:
      "Plan and build a complete music video from an Atlas track, with creative approvals and cost gates before paid generation.",
    href: "/studio/video",
    cta: "Open Video Director",
  },
];

export default function CreatePage() {
  return (
    <>
      <PageHeader
        title="Create"
        description="Choose the outcome. Atlas keeps the machinery behind the scenes until you actually need it."
      />
      <div className="v2-create-grid">
        {createOptions.map((item) => (
          <Link className="v2-create-card" href={item.href} key={item.title}>
            <span className="section-label">{item.eyebrow}</span>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
            <strong>{item.cta} →</strong>
          </Link>
        ))}
      </div>
      <details className="v2-advanced-disclosure">
        <summary>Advanced creation tools</summary>
        <Panel title="Open specialist workspaces only when the normal flow is not enough.">
          <div className="v2-secondary-links">
            <Link href="/studio/campaigns">Campaign Brain</Link>
            <Link href="/studio/outreach">Outreach</Link>
            <Link href="/studio/content">Legacy Content Lab</Link>
          </div>
        </Panel>
      </details>
    </>
  );
}
