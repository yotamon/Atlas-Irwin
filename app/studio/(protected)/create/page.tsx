import Link from "next/link";
import { PageHeader } from "@/components/studio/ui";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { requireArtistContext } from "@/lib/studio/artist-context";

export default async function CreatePage() {
  const artist = await requireArtistContext();
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);
  const outcomes = [
    {
      index: "01",
      eyebrow: "Music",
      title: "Create a track",
      description: "Start from a musical idea. Ensemblis keeps provider, prompt and timing controls hidden until you want them.",
      href: href("/studio/music?view=generate"),
      cta: "Create music",
    },
    {
      index: "02",
      eyebrow: "Release",
      title: "Start a release",
      description: "Create the release identity first. Ensemblis classifies the lifecycle and builds only the work that is still actionable.",
      href: href("/studio/releases/new"),
      cta: "Create release",
    },
    {
      index: "03",
      eyebrow: "Campaign creative",
      title: "Make content",
      description: "Create or refine the actual campaign assets Ensemblis has planned, using the music and release context already in the system.",
      href: href("/studio/production"),
      cta: "Open production",
    },
    {
      index: "04",
      eyebrow: "Motion",
      title: "Direct a video",
      description: "Build a music-aware visual treatment, review spend checkpoints and keep generated shots inside one coherent creative world.",
      href: href("/studio/video"),
      cta: "Open Video Director",
    },
  ];

  return (
    <div className="studio-v2-page create-polish-page">
      <PageHeader
        title="Create"
        description={`Choose the thing you want to make for ${artist.artistName}. Ensemblis supplies the context and sensible defaults; specialist controls stay available without becoming the starting point.`}
      />

      <section className="create-intent-list" aria-label="Creation outcomes">
        {outcomes.map((item) => (
          <Link className="create-intent-row" href={item.href} key={item.title}>
            <span className="create-intent-index">{item.index}</span>
            <span className="create-intent-copy">
              <small>{item.eyebrow}</small>
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </span>
            <b>{item.cta} →</b>
          </Link>
        ))}
      </section>

      <aside className="create-next-action-callout">
        <div>
          <span className="section-label">Not sure what to make next?</span>
          <strong>Use the decision Ensemblis has already ranked.</strong>
          <p>Today separates what needs your judgment from work the system can keep doing on its own.</p>
        </div>
        <Link className="button" href={href("/studio")}>Open Today</Link>
      </aside>

      <details className="v2-advanced-disclosure create-specialist-tools">
        <summary>Specialist and legacy tools</summary>
        <div className="create-specialist-links">
          <Link href={href("/studio/campaigns")}>Campaign Brain <span>Strategy overrides and campaign debugging</span></Link>
          <Link href={href("/studio/outreach")}>Outreach <span>Direct relationship and outreach workflows</span></Link>
          <Link href={href("/studio/content")}>Legacy Content Lab <span>Older content controls kept for exceptional cases</span></Link>
        </div>
      </details>
    </div>
  );
}
