import Link from "next/link";
import { reviewLearning } from "@/app/studio/learning-actions";
import { EmptyState, PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { aggregateMetrics, formatRate, metricSignals, objectivePerformanceScore, primarySignalValue } from "@/lib/marketing/domain";
import { describeLearningEffect } from "@/lib/marketing/learning-contract";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";

type LearningRow = {
  id: string;
  campaign_id: string | null;
  scope: string;
  finding: string;
  evidence: unknown;
  confidence: number;
  status: "proposed" | "approved" | "rejected" | "superseded";
  source: string;
  effect?: unknown;
  evidence_sample_size?: number;
  evidence_window_start?: string | null;
  evidence_window_end?: string | null;
  expires_at?: string | null;
  supersedes_learning_id?: string | null;
};

function compactDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function isExpired(learning: LearningRow, now: number) {
  if (!learning.expires_at) return false;
  return new Date(learning.expires_at).getTime() <= now;
}

export default async function LearnPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const marketing = asMarketingClient(supabase);
  const [metricsResult, contentResult, learningsResult, campaignsResult] = await Promise.all([
    marketing.from("metric_snapshots").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("captured_at", { ascending: false }),
    marketing.from("content_items").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    marketing.from("marketing_learnings").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("created_at", { ascending: false }),
    marketing.from("campaigns").select("id,name,status,objective,primary_kpi").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("updated_at", { ascending: false }),
  ]);
  const error = [metricsResult, contentResult, learningsResult, campaignsResult].find((result) => result.error)?.error;
  if (error) throw new Error(error.message);

  const metrics = metricsResult.data ?? [];
  const content = contentResult.data ?? [];
  const learnings = (learningsResult.data ?? []) as unknown as LearningRow[];
  const now = Date.now();
  const contentById = new Map(content.map((item) => [item.id, item]));
  const providerAttributedMetrics = metrics.filter((metric) => {
    const item = metric.content_item_id ? contentById.get(metric.content_item_id) : null;
    const hasMoment = Boolean(item && "moment_id" in item && item.moment_id);
    return metric.source !== "manual" && Boolean(metric.external_object_id?.trim()) && hasMoment;
  });
  const totals = aggregateMetrics(providerAttributedMetrics as unknown as Array<Record<string, unknown>>);
  const signals = metricSignals(totals);
  const proposed = learnings.filter((learning) => learning.status === "proposed" && !isExpired(learning, now));
  const staleProposals = learnings.filter((learning) => learning.status === "proposed" && isExpired(learning, now));
  const approved = learnings.filter((learning) => learning.status === "approved" && !isExpired(learning, now));
  const expiredMemory = learnings.filter((learning) => learning.status === "approved" && isExpired(learning, now));
  const manualOrUntrustedMetricCount = metrics.length - providerAttributedMetrics.length;
  const ranked = content
    .map((item) => {
      const rows = providerAttributedMetrics.filter((metric) => metric.content_item_id === item.id);
      const aggregate = aggregateMetrics(rows as unknown as Array<Record<string, unknown>>);
      return { ...item, score: objectivePerformanceScore(item.goal, aggregate), signal: primarySignalValue(item.goal, aggregate) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Learn"
        description={`Ensemblis turns verified ${artist.artistName} outcomes into reviewable, expiring decision rules. Manual or unattributed metrics stay in analytics and never silently train the system.`}
        action={<Link className="button" href="/studio/analytics">Advanced analytics</Link>}
      />
      <section className="v2-status-grid">
        <article><strong>{(totals.reach || totals.views || 0).toLocaleString()}</strong><span>trusted reach</span><small>Provider-attributed Moment content only</small></article>
        <article><strong>{formatRate(signals.saveRate)}</strong><span>save rate</span><small>From trusted evidence</small></article>
        <article><strong>{formatRate(signals.linkClickRate)}</strong><span>link click rate</span><small>From trusted evidence</small></article>
        <article><strong>{approved.length}</strong><span>active learnings</span><small>Approved and not expired</small></article>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading">
          <div><span className="section-label">Needs you</span><h2>{proposed.length ? `${proposed.length} evidence-backed proposal${proposed.length === 1 ? "" : "s"}` : "No learning decisions waiting"}</h2></div>
          <span className={`v2-count ${proposed.length ? "has-items" : ""}`}>{proposed.length}</span>
        </div>
        {proposed.length ? <div className="v2-learning-review">{proposed.map((learning) => {
          const sample = learning.evidence_sample_size ?? 0;
          const windowStart = compactDate(learning.evidence_window_start);
          const windowEnd = compactDate(learning.evidence_window_end);
          const expiry = compactDate(learning.expires_at);
          return (
            <article key={learning.id}>
              <div>
                <span>{learning.scope} · {Math.round(Number(learning.confidence) * 100)}% confidence{sample ? ` · ${sample.toLocaleString()} qualified observations` : ""}</span>
                <strong>{learning.finding}</strong>
                <small>{describeLearningEffect(learning.effect)}</small>
                <small>
                  Source: {learning.source}
                  {windowStart || windowEnd ? ` · Evidence ${windowStart ?? "?"} to ${windowEnd ?? "?"}` : ""}
                  {expiry ? ` · Expires ${expiry}` : ""}. Nothing changes until you approve it.
                </small>
              </div>
              <div className="actions">
                <form action={reviewLearning}><input type="hidden" name="artist_id" value={artist.artistId} /><input type="hidden" name="learning_id" value={learning.id} /><input type="hidden" name="status" value="approved" /><button className="button primary" type="submit">Approve</button></form>
                <form action={reviewLearning}><input type="hidden" name="artist_id" value={artist.artistId} /><input type="hidden" name="learning_id" value={learning.id} /><input type="hidden" name="status" value="rejected" /><button className="button" type="submit">Reject</button></form>
              </div>
            </article>
          );
        })}</div> : <div className="v2-calm-state compact"><strong>Ensemblis has no trustworthy conclusion waiting for approval.</strong><p>It will wait for enough correctly attributed provider evidence instead of inventing a pattern.</p></div>}
        {staleProposals.length ? <p className="v2-muted-copy">{staleProposals.length} older proposal{staleProposals.length === 1 ? " has" : "s have"} expired evidence and can no longer be approved into the decision path.</p> : null}
      </section>

      <div className="v2-two-column">
        <section className="v2-section v2-compact-section">
          <div className="v2-section-heading"><div><span className="section-label">What worked</span><h2>Top verified content by its own job</h2></div></div>
          {ranked.length ? <div className="v2-simple-list">{ranked.map((item) => <Link href={`/studio/production?edit=${item.id}`} key={item.id}><span>{item.platform}</span><strong>{item.title}</strong><small>{item.goal === "Reach" ? Math.round(item.signal).toLocaleString() : formatRate(item.signal)}</small></Link>)}</div> : <EmptyState title="No reliable ranking yet" body="Ensemblis waits for provider-attributed Moment performance instead of treating manual or ambiguous data as truth." />}
        </section>
        <section className="v2-section v2-compact-section">
          <div className="v2-section-heading"><div><span className="section-label">Memory</span><h2>What Ensemblis may reuse now</h2></div></div>
          {approved.length ? <div className="v2-learning-list">{approved.slice(0, 6).map((learning) => <div key={learning.id}><strong>{Math.round(Number(learning.confidence) * 100)}%</strong><p>{learning.finding}</p><small>{describeLearningEffect(learning.effect)}</small></div>)}</div> : <div className="v2-calm-state compact"><strong>No active approved memory yet.</strong><p>Only approved, unexpired structured effects can influence future ranking.</p></div>}
          {expiredMemory.length ? <p className="v2-muted-copy">{expiredMemory.length} approved learning{expiredMemory.length === 1 ? " is" : "s are"} retained as history but no longer influence decisions because the evidence expired.</p> : null}
        </section>
      </div>

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading"><div><span className="section-label">Data coverage</span><h2>Trust before volume</h2></div></div>
        <div className="v2-data-coverage">
          <div><strong>{providerAttributedMetrics.length}</strong><span>provider-attributed Moment snapshots</span></div>
          <div><strong>{manualOrUntrustedMetricCount}</strong><span>analytics-only snapshots</span></div>
          <div><strong>{campaignsResult.data?.filter((campaign) => campaign.status === "active").length ?? 0}</strong><span>active measurement systems</span></div>
        </div>
        <p className="v2-muted-copy">Automatic learning requires explicit Moment → content lineage plus a provider object identifier. Manual entries, inferred campaign context, and unattributed imports remain useful for inspection but cannot train Ensemblis.</p>
      </section>
    </div>
  );
}
