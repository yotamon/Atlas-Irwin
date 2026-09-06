import Link from "next/link";
import { PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { loadArtistMemory } from "@/lib/artist-memory/server";
import type { ArtistMemoryClass, ArtistMemoryItem } from "@/lib/artist-memory/domain";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";

const CLASS_LABELS: Record<ArtistMemoryClass, string> = {
  identity: "Identity",
  creative_rule: "Creative rule",
  preference_evidence: "Preference evidence",
  performance_learning: "Performance learning",
  strategic_constraint: "Strategic constraint",
  provenance_compliance: "Provenance & compliance",
};

function compactDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function confidence(item: ArtistMemoryItem) {
  if (item.confidence.label === "explicit") return "Explicit artist rule";
  const percent = Math.round(item.confidence.score * 100);
  const sample = item.confidence.sampleSize ? ` · ${item.confidence.sampleSize} decision${item.confidence.sampleSize === 1 ? "" : "s"}` : "";
  return `${percent}% ${item.confidence.label} confidence${sample}`;
}

export default async function ArtistMemoryPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const memory = await loadArtistMemory({ db: supabase, ownerId: user.id, artistId: artist.artistId });
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);
  const active = memory.items.filter((item) => item.lifecycle === "active");
  const historical = memory.items.filter((item) => item.lifecycle !== "active");

  return (
    <div className="studio-v2-page">
      <PageHeader title="Artist Memory" description={`What Ensemblis currently knows about ${artist.artistName}.`} action={<Link className="button primary" href={href("/studio/brand")}>Edit artist rules</Link>} />

      <section className="v2-status-grid" aria-label="Artist Memory summary">
        <article><strong>{memory.activeCount}</strong><span>active memory items</span><small>Currently allowed to influence decisions</small></article>
        <article><strong>{memory.explicitCount}</strong><span>explicit rules</span><small>Artist-authored guidance</small></article>
        <article><strong>{memory.learnedCount}</strong><span>learned signals</span><small>Reviewed decisions and outcomes</small></article>
        <article><strong>{memory.candidateCount}</strong><span>candidates</span><small>Not active before approval</small></article>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading">
          <div><span className="section-label">Current memory</span><h2>Why Ensemblis believes what it believes</h2><p>{memory.summary}</p></div>
          <Link className="button" href={href("/studio/learn")}>Review learning evidence</Link>
        </div>

        {active.length ? <div className="v2-learning-review">{active.map((item) => (
          <article key={item.id}>
            <div>
              <span>{CLASS_LABELS[item.class]}</span><strong>{item.title}</strong><p>{item.value}</p><small>{item.summary}</small>
              <details className="track-object-advanced">
                <summary>Why does Ensemblis know this?</summary>
                <div>
                  <p>{confidence(item)}</p>
                  <p>Source: {item.source.label}{compactDate(item.source.observedAt) ? ` · ${compactDate(item.source.observedAt)}` : ""}</p>
                  {item.expiresAt ? <p>Expires: {compactDate(item.expiresAt) ?? item.expiresAt}</p> : null}
                  <p>Allowed consumers: {item.consumers.length ? item.consumers.join(", ").replaceAll("_", " ") : "none"}</p>
                  <Link className="button" href={href(item.source.href)}>Open source</Link>
                </div>
              </details>
            </div>
            <div className="actions"><Status>{item.confidence.label === "explicit" ? "Artist rule" : "Learned"}</Status></div>
          </article>
        ))}</div> : <div className="v2-calm-state"><strong>No durable artist memory yet.</strong><p>Add explicit artist guidance first. Learned signals only become active after trustworthy evidence and review.</p></div>}
      </section>

      {historical.length ? <details className="v2-section"><summary>{historical.length} inactive or expired memory item{historical.length === 1 ? "" : "s"}</summary><div className="v2-learning-list">{historical.map((item) => <div key={item.id}><strong>{CLASS_LABELS[item.class]}</strong><p>{item.value}</p><small>{item.lifecycle}{item.expiresAt ? ` · ${compactDate(item.expiresAt) ?? item.expiresAt}` : ""} · retained as evidence, not active guidance</small></div>)}</div></details> : null}

      <details className="v2-section v2-compact-section">
        <summary><strong>Memory is evidence, not chat history</strong><span>Authority, evidence and expiry</span></summary>
        <p className="v2-muted-copy">Explicit artist rules outrank inferred preferences. Learned signals must be reviewed, attributable and unexpired. Each consumer receives only the memory classes it is allowed to use.</p>
      </details>
    </div>
  );
}
