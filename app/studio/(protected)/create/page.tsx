import Link from "next/link";
import { PageHeader, Panel } from "@/components/studio/ui";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { requireArtistContext } from "@/lib/studio/artist-context";

export default async function CreatePage() {
  const artist = await requireArtistContext();
  const primaryOutcomes = [
    {
      title: `Move ${artist.artistName} forward`,
      eyebrow: "Recommended",
      description:
        `Start from the highest-leverage decision. Today already knows what is blocked, what ${artist.artistName} is preparing and which release needs attention.`,
      href: ensemblisArtistHref("/studio", artist.artistId),
      cta: "Open Today",
    },
    {
      title: "Start a release",
      eyebrow: "New release",
      description:
        "Create the minimum release workspace. Ensemblis classifies its lifecycle and builds only the work that is still actionable.",
      href: ensemblisArtistHref("/studio/releases/new", artist.artistId),
      cta: "Create release",
    },
    {
      title: "Develop new music",
      eyebrow: "Artist-led creation",
      description:
        "Use Music Lab when the goal is making a new track, not when a campaign simply needs another asset.",
      href: ensemblisArtistHref("/studio/music", artist.artistId),
      cta: "Open Music Lab",
    },
  ];

  return (
    <>
      <PageHeader
        title="Create"
        description={`Start with the outcome for ${artist.artistName}. Ensemblis chooses campaign machinery automatically; specialist tools stay available when you deliberately want to direct the craft.`}
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
            <Link href={ensemblisArtistHref("/studio/production", artist.artistId)}>Production queue</Link>
            <Link href={ensemblisArtistHref("/studio/video", artist.artistId)}>Video Director</Link>
            <Link href={ensemblisArtistHref("/studio/campaigns", artist.artistId)}>Campaign Brain</Link>
            <Link href={ensemblisArtistHref("/studio/outreach", artist.artistId)}>Outreach</Link>
            <Link href={ensemblisArtistHref("/studio/content", artist.artistId)}>Legacy Content Lab</Link>
          </div>
        </Panel>
      </details>
    </>
  );
}
