import Link from "next/link";
import { deleteStudioRecord, saveLearning, saveMetric } from "@/app/studio/analytics-actions";
import { setLearningStatus } from "@/app/studio/marketing-actions";
import { EmptyState, Field, PageHeader, Panel, Status, Submit } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { aggregateMetrics, formatRate, metricSignals, primarySignalValue } from "@/lib/marketing/domain";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { PLATFORMS } from "@/lib/studio/constants";
import { buildGrowthFunnel, diagnoseGrowthFunnel } from "@/lib/studio/growth";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import { goalPerformanceScore } from "@/lib/studio/performance";

function percent(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

export default async function AnalyticsPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const marketing = asMarketingClient(supabase);
  const music = asArtistScopedMusicClient(supabase);
  const operational = asArtistScopedOperationalClient(supabase);
  const [metricsResult, releasesResult, contentResult, legacyLearningsResult, campaignsResult, marketingLearningsResult] = await Promise.all([
    marketing.from("metric_snapshots").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("captured_at", { ascending: false }),
    music.from("releases").select("id,title").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("title"),
    marketing.from("content_items").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    operational.from("release_learnings").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("created_at", { ascending: false }),
    marketing.from("campaigns").select("id,name,objective,primary_kpi,status").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("updated_at", { ascending: false }),
    marketing.from("marketing_learnings").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("created_at", { ascending: false }),
  ]);
  const firstError = [metricsResult, releasesResult, contentResult, legacyLearningsResult, campaignsResult, marketingLearningsResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const metrics = metricsResult.data ?? [];
  const releases = releasesResult.data ?? [];
  const content = contentResult.data ?? [];
  const campaigns = campaignsResult.data ?? [];
  const marketingLearnings = marketingLearningsResult.data ?? [];
  const totals = aggregateMetrics(metrics as unknown as Array<Record<string, unknown>>);
  const totalSignals = metricSignals(totals);
  const funnel = buildGrowthFunnel(metrics);
  const diagnosis = diagnoseGrowthFunnel(funnel);
  const ranked = content
    .map((item) => {
      const rows = metrics.filter((metric) => metric.content_item_id === item.id);
      const aggregate = aggregateMetrics(rows as unknown as Array<Record<string, unknown>>);
      return { ...item, aggregate, score: goalPerformanceScore(item.goal, aggregate), primarySignal: primarySignalValue(item.goal, aggregate) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const proposedLearnings = marketingLearnings.filter((learning) => learning.status === "proposed");

  return (
    <>
      <PageHeader title="Growth Analytics" description={`Find where attention stops becoming fandom for ${artist.artistName}, then use content-level experiments to explain why.`} action={<Link className="button primary" href="/studio/growth">Open Growth OS</Link>} />
      <div className="studio-grid">
        <Panel title="Active fan signal">{funnel.fanSignalScore.toLocaleString()}</Panel>
        <Panel title="Listeners">{funnel.listeners.toLocaleString()}</Panel>
        <Panel title="Save rate">{formatRate(funnel.saveRate)}</Panel>
        <Panel title="Follow rate">{formatRate(funnel.followRate)}</Panel>
      </div>

      <section className="studio-panel feature growth-analytics-funnel">
        <div className="panel-head"><div><span className="section-label">Audience conversion</span><h2>Discovery → fandom</h2></div></div>
        <div className="growth-funnel">
          <article><span>Discovery</span><strong>{funnel.reach.toLocaleString()}</strong><small>qualified reach / views</small></article><i>→</i>
          <article><span>Curiosity</span><strong>{funnel.profileVisits.toLocaleString()}</strong><small>{percent(funnel.profileVisitRate)} reach → profile</small></article><i>→</i>
          <article><span>Music intent</span><strong>{funnel.linkClicks.toLocaleString()}</strong><small>{percent(funnel.linkClickRate)} profile → click</small></article><i>→</i>
          <article><span>Listening</span><strong>{funnel.listeners.toLocaleString()}</strong><small>{percent(funnel.listenerConversionRate)} click → listener</small></article><i>→</i>
          <article><span>Fandom</span><strong>{(funnel.saves + funnel.follows + funnel.playlistAdds).toLocaleString()}</strong><small>{percent(funnel.saveRate)} save · {percent(funnel.followRate)} follow</small></article>
        </div>
        {diagnosis ? <div className="growth-action-note"><strong>Current bottleneck: {diagnosis.label}</strong><span>{diagnosis.diagnosis} {diagnosis.action}</span></div> : <div className="v2-calm-state compact"><strong>No reliable bottleneck yet.</strong><p>Add more linked performance data before Ensemblis declares where the funnel is weak.</p></div>}
      </section>

      <section className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Objective-aware ranking</span><h2>Which creative actually did its job?</h2></div></div>
        {ranked.length ? <table className="studio-table"><thead><tr><th>Content</th><th>Goal</th><th>Platform</th><th>Primary signal</th><th>Goal score</th></tr></thead><tbody>{ranked.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><br /><small>{item.format}</small></td><td>{item.goal}</td><td>{item.platform}</td><td>{item.goal === "Reach" ? Math.round(item.primarySignal).toLocaleString() : formatRate(item.primarySignal)}</td><td>{item.score}</td></tr>)}</tbody></table> : <EmptyState title="No ranked content yet" body="Link metric snapshots to content or campaign variants. Ensemblis will not invent a winner from missing data." />}
        <p><small>Scores remain job-specific. Growth diagnosis above asks a different question: where the entire listener journey is leaking.</small></p>
      </section>

      <section className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Campaign context</span><h2>Active measurement systems</h2></div></div>
        {campaigns.length ? campaigns.map((campaign) => <Link className="list-row" href={`/studio/campaigns/${campaign.id}`} key={campaign.id}><span><strong>{campaign.name}</strong><br /><small>{campaign.objective} / KPI: {campaign.primary_kpi}</small></span><Status>{campaign.status}</Status></Link>) : <EmptyState title="No campaigns yet" body="Create a first-class campaign to connect content, experiments, attribution and learnings." href="/studio/campaigns#new" label="Create campaign" />}
      </section>

      <section className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Human-reviewed memory</span><h2>Learning proposals</h2></div><Status>{proposedLearnings.length} proposed</Status></div>
        {marketingLearnings.length ? marketingLearnings.map((learning) => <article className="list-row" key={learning.id}><div><strong>{learning.finding}</strong><br /><small>{learning.scope} / {Math.round(Number(learning.confidence) * 100)}% confidence / {learning.source}</small></div>{learning.status === "proposed" ? <div className="actions"><form action={setLearningStatus}><input type="hidden" name="artist_id" value={artist.artistId} /><input type="hidden" name="learning_id" value={learning.id} /><input type="hidden" name="status" value="approved" /><button className="button primary" type="submit">Approve</button></form><form action={setLearningStatus}><input type="hidden" name="artist_id" value={artist.artistId} /><input type="hidden" name="learning_id" value={learning.id} /><input type="hidden" name="status" value="rejected" /><button className="button" type="submit">Reject</button></form></div> : <Status>{learning.status}</Status>}</article>) : <EmptyState title="No structured learnings yet" body="When an experiment clears its sample and lift threshold, Ensemblis proposes a learning here. It is never promoted without approval." />}
      </section>

      <section id="new" className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Fallback data entry</span><h2>Add metric snapshot</h2></div></div>
        <p><small>Use campaign variant metric entry when possible. This form remains for platform or release-level snapshots and legacy integrations.</small></p>
        <form action={saveMetric} className="studio-form"><input type="hidden" name="artist_id" value={artist.artistId} /><div className="form-grid">
          <Field label="Date"><input type="date" name="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
          <Field label="Platform"><select name="platform">{PLATFORMS.filter((platform) => platform !== "Other").map((platform) => <option key={platform}>{platform}</option>)}</select></Field>
          <Field label="Release"><select name="release_id"><option value="">None</option>{releases.map((release) => <option value={release.id} key={release.id}>{release.title}</option>)}</select></Field>
          <Field label="Content item"><select name="content_item_id"><option value="">None</option>{content.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></Field>
          {["reach","views","watch_time","likes","comments","shares","saves","profile_visits","follows","link_clicks","streams","listeners","playlist_adds"].map((key) => <Field label={key.replaceAll("_", " ")} key={key}><input type="number" min="0" name={key} defaultValue="0" /></Field>)}
          <Field label="Notes" wide><textarea name="notes" /></Field>
        </div><Submit>Save snapshot</Submit></form>
      </section>

      <section className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Legacy release notes</span><h2>Manual learnings</h2></div></div>
        {legacyLearningsResult.data?.length ? legacyLearningsResult.data.map((learning) => <blockquote key={learning.id}>{learning.learning}</blockquote>) : <EmptyState title="No manual release learnings" body="Structured campaign learnings above are preferred for new evidence." />}
        <form action={saveLearning} className="studio-form"><input type="hidden" name="artist_id" value={artist.artistId} /><div className="form-grid"><Field label="Release"><select name="release_id" required><option value="">Select release</option>{releases.map((release) => <option value={release.id} key={release.id}>{release.title}</option>)}</select></Field><Field label="Learning"><input name="learning" required placeholder="Manual observation worth preserving" /></Field></div><Submit>Save manual learning</Submit></form>
      </section>

      {metrics.length ? <section className="studio-panel feature"><div className="panel-head"><h2>Snapshot history</h2></div><table className="studio-table"><thead><tr><th>Date</th><th>Platform</th><th>Views</th><th>Follows</th><th>Source</th><th></th></tr></thead><tbody>{metrics.map((metric) => <tr key={metric.id}><td>{metric.date}</td><td>{metric.platform}</td><td>{metric.views}</td><td>{metric.follows}</td><td>{metric.source}</td><td><form action={deleteStudioRecord}><input type="hidden" name="artist_id" value={artist.artistId} /><input type="hidden" name="id" value={metric.id} /><input type="hidden" name="table" value="metric_snapshots" /><button className="text-button">Delete</button></form></td></tr>)}</tbody></table></section> : null}
      <span className="sr-only">Save rate {formatRate(totalSignals.saveRate)}</span>
    </>
  );
}
