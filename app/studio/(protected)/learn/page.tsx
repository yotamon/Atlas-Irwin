import Link from "next/link";
import { setLearningStatus } from "@/app/studio/marketing-actions";
import { EmptyState, PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { aggregateMetrics, formatRate, metricSignals, objectivePerformanceScore, primarySignalValue } from "@/lib/marketing/domain";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";

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
  const learnings = learningsResult.data ?? [];
  const totals = aggregateMetrics(metrics as unknown as Array<Record<string, unknown>>);
  const signals = metricSignals(totals);
  const proposed = learnings.filter((learning) => learning.status === "proposed");
  const approved = learnings.filter((learning) => learning.status === "approved");
  const automaticMetricCount = metrics.filter((metric) => metric.source && metric.source !== "manual").length;
  const manualMetricCount = metrics.length - automaticMetricCount;
  const ranked = content
    .map((item) => {
      const rows = metrics.filter((metric) => metric.content_item_id === item.id);
      const aggregate = aggregateMetrics(rows as unknown as Array<Record<string, unknown>>);
      return { ...item, score: objectivePerformanceScore(item.goal, aggregate), signal: primarySignalValue(item.goal, aggregate) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return (
    <div className="studio-v2-page">
      <PageHeader title="Learn" description={`Ensemblis turns ${artist.artistName}'s performance into reusable decisions. Manual data entry exists only as an advanced fallback.`} action={<Link className="button" href="/studio/analytics">Advanced analytics</Link>} />
      <section className="v2-status-grid">
        <article><strong>{(totals.reach || totals.views || 0).toLocaleString()}</strong><span>qualified reach</span><small>Across recorded performance</small></article>
        <article><strong>{formatRate(signals.saveRate)}</strong><span>save rate</span><small>Reusable intent signal</small></article>
        <article><strong>{formatRate(signals.linkClickRate)}</strong><span>link click rate</span><small>Streaming intent</small></article>
        <article><strong>{approved.length}</strong><span>approved learnings</span><small>Used by future planning</small></article>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Needs you</span><h2>{proposed.length ? `${proposed.length} learning proposal${proposed.length === 1 ? "" : "s"}` : "No learning decisions waiting"}</h2></div><span className={`v2-count ${proposed.length ? "has-items" : ""}`}>{proposed.length}</span></div>
        {proposed.length ? <div className="v2-learning-review">{proposed.map((learning) => (
          <article key={learning.id}>
            <div><span>{learning.scope} · {Math.round(Number(learning.confidence) * 100)}% confidence</span><strong>{learning.finding}</strong><small>Source: {learning.source}. Ensemblis will not reuse this conclusion until you approve it.</small></div>
            <div className="actions">
              <form action={setLearningStatus}><input type="hidden" name="artist_id" value={artist.artistId} /><input type="hidden" name="learning_id" value={learning.id} /><input type="hidden" name="status" value="approved" /><button className="button primary" type="submit">Approve</button></form>
              <form action={setLearningStatus}><input type="hidden" name="artist_id" value={artist.artistId} /><input type="hidden" name="learning_id" value={learning.id} /><input type="hidden" name="status" value="rejected" /><button className="button" type="submit">Reject</button></form>
            </div>
          </article>
        ))}</div> : <div className="v2-calm-state compact"><strong>Ensemblis has no uncertain conclusions for you.</strong><p>Reliable experiment results will appear here instead of becoming hidden configuration.</p></div>}
      </section>

      <div className="v2-two-column">
        <section className="v2-section v2-compact-section">
          <div className="v2-section-heading"><div><span className="section-label">What worked</span><h2>Top content by its own job</h2></div></div>
          {ranked.length ? <div className="v2-simple-list">{ranked.map((item) => <Link href={`/studio/production?edit=${item.id}`} key={item.id}><span>{item.platform}</span><strong>{item.title}</strong><small>{item.goal === "Reach" ? Math.round(item.signal).toLocaleString() : formatRate(item.signal)}</small></Link>)}</div> : <EmptyState title="No reliable ranking yet" body="Ensemblis waits for performance evidence instead of inventing winners." />}
        </section>
        <section className="v2-section v2-compact-section">
          <div className="v2-section-heading"><div><span className="section-label">Memory</span><h2>What Ensemblis will reuse</h2></div></div>
          {approved.length ? <div className="v2-learning-list">{approved.slice(0, 6).map((learning) => <div key={learning.id}><strong>{Math.round(Number(learning.confidence) * 100)}%</strong><p>{learning.finding}</p></div>)}</div> : <div className="v2-calm-state compact"><strong>No approved memory yet.</strong><p>Approved learnings become context for future release planning.</p></div>}
        </section>
      </div>

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading"><div><span className="section-label">Data coverage</span><h2>Automation first</h2></div></div>
        <div className="v2-data-coverage"><div><strong>{automaticMetricCount}</strong><span>automated/imported snapshots</span></div><div><strong>{manualMetricCount}</strong><span>manual fallback snapshots</span></div><div><strong>{campaignsResult.data?.filter((campaign) => campaign.status === "active").length ?? 0}</strong><span>active measurement systems</span></div></div>
        <p className="v2-muted-copy">Manual metric entry and legacy release notes remain available in Advanced analytics, but they are no longer part of the normal workflow.</p>
      </section>
    </div>
  );
}
