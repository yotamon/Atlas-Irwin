import Link from "next/link";
import { CalmState, DecisionQueue, DecisionRow, PriorityHero, type SemanticTone } from "@/components/studio/patterns";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { loadArtistOperatingSnapshot } from "@/lib/studio/artist-operating-snapshot";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { needsYouTone } from "@/lib/studio/needs-you";

function decisionTone(value: string): SemanticTone {
  if (value === "important") return "danger";
  if (value === "warning") return "attention";
  return "neutral";
}

export default async function NeedsYouPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const snapshot = await loadArtistOperatingSnapshot({
    db: supabase,
    userId: user.id,
    artist,
  });
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);
  const queue = snapshot.needsYou;
  const required = queue.filter((item) => item.severity === "required");
  const review = queue.filter((item) => item.severity !== "required");
  const renderDecision = (entry: (typeof queue)[number]) => {
    const timing = entry.timing.label ? ` · ${entry.timing.label}` : "";
    return (
      <DecisionRow
        href={href(entry.href)}
        key={entry.id}
        meta={`${entry.category} · ${entry.severity}${timing}`}
        title={entry.title}
        description={entry.detail}
        tone={decisionTone(needsYouTone(entry))}
      />
    );
  };

  return (
    <div className="studio-v2-page needs-you-page">
      <PageHeader title="Needs You" description={`Only decisions that genuinely require ${artist.artistName}'s judgment.`} action={<Link className="button" href={href("/studio")}>Back to Today</Link>} />

      <PriorityHero
        eyebrow="Decision queue"
        title={queue.length ? `${queue.length} decision${queue.length === 1 ? "" : "s"} worth your attention` : "Ensemblis can keep moving"}
        description={queue.length ? "Release blockers and spend stop conditions come first, then external effects, ambiguity and review work. Resolve the source action and the queue updates automatically." : "Nothing currently needs human judgment. Safe internal work can continue without manufacturing tasks."}
        status={required.length ? "Blocked" : queue.length ? "Needs attention" : "Clear"}
        tone={required.length ? "danger" : queue.length ? "attention" : "success"}
      />

      {required.length ? <DecisionQueue eyebrow="Required now" title="Blocking decisions" count={required.length}>{required.map(renderDecision)}</DecisionQueue> : null}

      {review.length ? <DecisionQueue eyebrow={required.length ? "Then review" : "Decisions"} title={required.length ? "Everything else" : "Needs you"} count={review.length}>{review.map(renderDecision)}</DecisionQueue> : null}

      {!queue.length ? <CalmState title="Nothing needs your judgment right now." body="Approvals, ambiguity, release blockers and trustworthy learning decisions will appear here automatically." /> : null}
    </div>
  );
}
