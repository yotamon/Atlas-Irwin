/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  approveAutomationJob,
  approveContentVariant,
  evaluateExperiment,
  generateCampaignStrategy,
  queueVariantPublication,
  rejectContentVariant,
  setLearningStatus,
  updateCampaignMode,
  updateCampaignStatus,
} from "@/app/studio/marketing-actions";
import {
  markPublicationPublished,
  runMarketingAutomationNow,
  saveCampaignMetric,
} from "@/app/studio/marketing-runtime-actions";
import styles from "@/components/studio/marketing-workspace.module.css";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import {
  CAMPAIGN_MODES,
  CAMPAIGN_STATUSES,
  aggregateMetrics,
  formatRate,
  metricSignals,
  primarySignalValue,
} from "@/lib/marketing/domain";
import { getSiteUrl } from "@/lib/site-url";
import type { Json } from "@/types/database";

function objectValue(value: Json) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function stringValue(value: Json | undefined) {
  return typeof value === "string" ? value : "";
}

function stringList(value: Json | undefined) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return "Unscheduled";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

function resultDetails(value: Json) {
  return objectValue(value);
}

function relativeLabel(day: number | null) {
  if (day === null) return "Fixed date";
  if (day === 0) return "Release day";
  return day < 0 ? `T${day}` : `T+${day}`;
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default async function CampaignWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const { data: campaign, error: campaignError } = await marketing
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (campaignError) throw new Error(campaignError.message);
  if (!campaign) notFound();

  const [
    releaseResult,
    phasesResult,
    experimentsResult,
    contentResult,
    variantsResult,
    metricsResult,
    linksResult,
    publicationsResult,
    jobsResult,
    learningsResult,
    generationRunsResult,
  ] = await Promise.all([
    campaign.release_id
      ? supabase
          .from("releases")
          .select("id,title,release_date,artwork_url,primary_hook,core_emotion,visual_direction,smart_link_url,spotify_url,soundcloud_url,status")
          .eq("id", campaign.release_id)
          .eq("owner_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    marketing.from("campaign_phases").select("*").eq("campaign_id", campaign.id).order("sort_order"),
    marketing.from("campaign_experiments").select("*").eq("campaign_id", campaign.id).order("created_at"),
    marketing.from("content_items").select("*").eq("campaign_id", campaign.id).order("scheduled_at", { ascending: true }),
    marketing.from("content_variants").select("*").eq("owner_id", user.id).order("created_at"),
    marketing.from("metric_snapshots").select("*").eq("campaign_id", campaign.id).order("captured_at", { ascending: false }),
    marketing.from("attribution_links").select("*").eq("campaign_id", campaign.id).order("created_at"),
    marketing.from("publication_jobs").select("*").eq("campaign_id", campaign.id).order("created_at", { ascending: false }),
    marketing.from("automation_jobs").select("*").eq("campaign_id", campaign.id).order("created_at", { ascending: false }).limit(30),
    marketing.from("marketing_learnings").select("*").eq("campaign_id", campaign.id).order("created_at", { ascending: false }),
    marketing.from("generation_runs").select("*").eq("campaign_id", campaign.id).order("created_at", { ascending: false }).limit(10),
  ]);
  const results = [phasesResult, experimentsResult, contentResult, variantsResult, metricsResult, linksResult, publicationsResult, jobsResult, learningsResult, generationRunsResult];
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);
  if (releaseResult.error) throw new Error(releaseResult.error.message);

  const release = releaseResult.data;
  const phases = phasesResult.data ?? [];
  const experiments = experimentsResult.data ?? [];
  const content = contentResult.data ?? [];
  const contentIds = new Set(content.map((item) => item.id));
  const variants = (variantsResult.data ?? []).filter((variant) => contentIds.has(variant.content_item_id));
  const metrics = metricsResult.data ?? [];
  const links = linksResult.data ?? [];
  const publications = publicationsResult.data ?? [];
  const jobs = jobsResult.data ?? [];
  const learnings = learningsResult.data ?? [];
  const generationRuns = generationRunsResult.data ?? [];
  const strategy = objectValue(campaign.strategy);
  const strategySummary = stringValue(strategy.strategySummary);
  const contentPillars = stringList(strategy.contentPillars);
  const learningsApplied = stringList(strategy.learningsApplied);
  const hasPlan = Boolean(strategy.planVersion);
  const now = Date.now();
  const currentPhase = phases.find((phase) => {
    const start = phase.starts_at ? new Date(phase.starts_at).getTime() : Number.NEGATIVE_INFINITY;
    const end = phase.ends_at ? new Date(phase.ends_at).getTime() : Number.POSITIVE_INFINITY;
    return now >= start && now < end;
  });
  const aggregate = aggregateMetrics(metrics as unknown as Array<Record<string, unknown>>);
  const signals = metricSignals(aggregate);
  const publishedCount = content.filter((item) => item.status === "Published").length;
  const pendingVariants = variants.filter((variant) => variant.approval_status === "pending" && variant.status !== "rejected").length;
  const waitingJobs = jobs.filter((job) => job.status === "awaiting_approval").length;
  const manualReady = publications.filter((job) => job.status === ("manual_ready" as never)).length;
  const siteUrl = getSiteUrl();
  const contentById = new Map(content.map((item) => [item.id, item]));
  const linkByVariantId = new Map(links.filter((link) => link.content_variant_id).map((link) => [link.content_variant_id!, link]));
  const experimentById = new Map(experiments.map((experiment) => [experiment.id, experiment]));
  const phaseById = new Map(phases.map((phase) => [phase.id, phase]));

  return (
    <div className={styles.shell}>
      <PageHeader
        title={campaign.name}
        description="One release strategy, one approval surface, one measurable learning loop."
        action={
          <div className="actions">
            <Link className="button" href="/studio/campaigns">All campaigns</Link>
            {release ? <Link className="button" href={`/studio/releases/${release.id}?tab=campaign`}>Release workspace</Link> : null}
          </div>
        }
      />

      <div className={styles.heroGrid}>
        <section className={styles.heroCard}>
          <span className={styles.eyebrow}>{campaign.status} / {campaign.mode}</span>
          <h1>{release?.title || campaign.name}</h1>
          <p>{strategySummary || release?.primary_hook || release?.core_emotion || "Generate the first campaign plan to turn this release into a testable marketing system."}</p>
          <div className={styles.heroMeta}>
            <span className={styles.statusChip}>{campaign.objective}</span>
            <span className={styles.chip}>Primary KPI: {campaign.primary_kpi}</span>
            <span className={styles.chip}>{currentPhase ? `Now: ${currentPhase.name}` : "Outside active phase window"}</span>
            <span className={styles.chip}>{release?.release_date || "Release date not set"}</span>
          </div>
        </section>

        <aside className={styles.controlCard}>
          <div className={styles.controlGroup}>
            <span className={styles.miniLabel}>Automation mode</span>
            <form action={updateCampaignMode}>
              <input type="hidden" name="campaign_id" value={campaign.id} />
              <select name="mode" defaultValue={campaign.mode}>{CAMPAIGN_MODES.map((mode) => <option value={mode} key={mode}>{mode}</option>)}</select>
              <button className="button" type="submit">Save</button>
            </form>
          </div>
          <div className={styles.controlGroup}>
            <span className={styles.miniLabel}>Campaign state</span>
            <form action={updateCampaignStatus}>
              <input type="hidden" name="campaign_id" value={campaign.id} />
              <select name="status" defaultValue={campaign.status}>{CAMPAIGN_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}</select>
              <button className="button" type="submit">Save</button>
            </form>
          </div>
          <div className={styles.controlGroup}>
            <span className={styles.miniLabel}>Planner</span>
            <form action={generateCampaignStrategy}>
              <input type="hidden" name="campaign_id" value={campaign.id} />
              {hasPlan ? <input type="hidden" name="force" value="1" /> : null}
              <button className="button primary" type="submit">{hasPlan ? "Regenerate draft plan" : "Generate campaign plan"}</button>
            </form>
            <small>{generationRuns[0] ? `Last plan: ${generationRuns[0].provider} / ${generationRuns[0].model}` : "No generation spend yet."}</small>
          </div>
          <div className={styles.controlGroup}>
            <span className={styles.miniLabel}>Runtime</span>
            <form action={runMarketingAutomationNow}>
              <input type="hidden" name="campaign_id" value={campaign.id} />
              <button className="button" type="submit">Run automation now</button>
            </form>
            <small>{waitingJobs} approval-gated jobs / {manualReady} manual publish handoffs</small>
          </div>
        </aside>
      </div>

      <div className={styles.statGrid}>
        <div className={styles.stat}><span>Content shipped</span><strong>{publishedCount}/{content.length}</strong><small>{pendingVariants} creative approvals waiting</small></div>
        <div className={styles.stat}><span>Qualified reach</span><strong>{(aggregate.reach ?? aggregate.views ?? 0).toLocaleString()}</strong><small>{aggregate.views ? `${aggregate.views.toLocaleString()} views` : "No view data yet"}</small></div>
        <div className={styles.stat}><span>Save rate</span><strong>{formatRate(signals.saveRate)}</strong><small>{(aggregate.saves ?? 0).toLocaleString()} saves</small></div>
        <div className={styles.stat}><span>Link intent</span><strong>{formatRate(signals.linkClickRate)}</strong><small>{(aggregate.link_clicks ?? 0).toLocaleString()} tracked clicks in imported metrics</small></div>
      </div>

      <section>
        <div className={styles.sectionHead}>
          <div><span className={styles.eyebrow}>Release-relative system</span><h2>Campaign phases</h2></div>
          <p>Unfinished, unlocked content moves automatically when the release date changes.</p>
        </div>
        <div className={styles.phaseRail}>
          {phases.map((phase) => (
            <article className={`${styles.phase}${currentPhase?.id === phase.id ? ` ${styles.phaseActive}` : ""}`} key={phase.id}>
              <span className={styles.miniLabel}>{phase.code}</span>
              <strong>{phase.name}</strong>
              <small>{phase.objective}</small>
              <time>{formatDate(phase.starts_at)} to {formatDate(phase.ends_at)}</time>
              <small>T{phase.relative_start_days >= 0 ? "+" : ""}{phase.relative_start_days} to T{phase.relative_end_days >= 0 ? "+" : ""}{phase.relative_end_days}</small>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHead}>
          <div><span className={styles.eyebrow}>Campaign thesis</span><h2>Strategy</h2></div>
          <p>{hasPlan ? `${generationRuns.length} recorded generation run${generationRuns.length === 1 ? "" : "s"}.` : "No generated strategy yet."}</p>
        </div>
        {hasPlan ? (
          <div className={styles.strategyGrid}>
            <div className={styles.strategyCopy}><p>{strategySummary}</p></div>
            <div>
              <span className={styles.miniLabel}>Content pillars</span>
              <div className={styles.tagCloud}>{contentPillars.map((pillar) => <span className={styles.chip} key={pillar}>{pillar}</span>)}</div>
              {learningsApplied.length ? <><span className={styles.miniLabel}>Evidence applied</span><div className={styles.tagCloud}>{learningsApplied.map((learning) => <span className={styles.chip} key={learning}>{learning}</span>)}</div></> : null}
            </div>
          </div>
        ) : (
          <div className={styles.emptyBrain}><div><span className={styles.eyebrow}>Zero automatic spend</span><h2>Generate when ready</h2><p>The planner call is explicit. Atlas will combine release identity, brand settings, approved learnings and historical performance. If the AI provider is unavailable, it falls back to an adaptive release-specific plan instead of generic templates.</p></div></div>
        )}
      </section>

      {release ? (
        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <div><span className={styles.eyebrow}>Production bridge</span><h2>Make the assets</h2></div>
            <p>The campaign owns the marketing hypothesis. Music Lab, Video Director and Media Library remain specialist production tools.</p>
          </div>
          <div className={styles.inlineActions}>
            <Link className="button" href="/studio/music">Open Music Lab</Link>
            <Link className="button primary" href={`/studio/releases/${release.id}?tab=video`}>Open Video Director</Link>
            <Link className="button" href={`/studio/releases/${release.id}?tab=media`}>Release media</Link>
            <Link className="button" href="/studio/content">Content Lab</Link>
          </div>
        </section>
      ) : null}

      <section>
        <div className={styles.sectionHead}>
          <div><span className={styles.eyebrow}>Test before scaling</span><h2>Experiments</h2></div>
          <p>Each experiment changes one framing variable and promotes a winner only after enough sample and minimum lift.</p>
        </div>
        <div className={styles.experimentList}>
          {experiments.length ? experiments.map((experiment) => {
            const experimentVariants = variants.filter((variant) => variant.experiment_id === experiment.id);
            const winnerId = experiment.winner_variant_id;
            const experimentMetrics = metrics.filter((metric) => metric.experiment_id === experiment.id);
            return (
              <article className={styles.experiment} key={experiment.id}>
                <div className={styles.experimentHead}>
                  <div>
                    <span className={styles.eyebrow}>{phaseById.get(experiment.phase_id || "")?.name || "Experiment"} / {experiment.status}</span>
                    <h3>{experiment.title}</h3>
                    <p>{experiment.hypothesis}</p>
                  </div>
                  <form action={evaluateExperiment}>
                    <input type="hidden" name="experiment_id" value={experiment.id} />
                    <button className="button" type="submit">Evaluate now</button>
                  </form>
                </div>
                {experiment.result_summary ? <div className={styles.experimentResult}>{experiment.result_summary}</div> : null}
                <div className={styles.variantGrid}>
                  {experimentVariants.map((variant) => {
                    const item = contentById.get(variant.content_item_id);
                    const variantMetrics = experimentMetrics.filter((metric) => metric.content_variant_id === variant.id);
                    const variantAggregate = aggregateMetrics(variantMetrics as unknown as Array<Record<string, unknown>>);
                    const variantSignals = metricSignals(variantAggregate);
                    const primarySignal = primarySignalValue(experiment.goal, variantAggregate);
                    const link = linkByVariantId.get(variant.id);
                    const publicLink = link ? `${siteUrl}/go/${link.code}` : null;
                    const isWinner = winnerId === variant.id;
                    return (
                      <article className={`${styles.variant}${isWinner ? ` ${styles.variantWinner}` : ""}`} key={variant.id}>
                        <div>
                          <span className={styles.eyebrow}>Variant {variant.label}{isWinner ? " / Winner" : ""}</span>
                          <h4>{item?.platform || "Content"} / {item?.format || "variant"}</h4>
                          <p className={styles.variantHook}>{variant.hook_text || "No hook copy"}</p>
                          <p>{variant.caption}</p>
                        </div>
                        <div className={styles.signalRow}>
                          <div className={styles.signal}><span>Sample</span><strong>{Math.max(variantAggregate.reach ?? 0, variantAggregate.views ?? 0).toLocaleString()}</strong></div>
                          <div className={styles.signal}><span>Primary</span><strong>{experiment.goal === "Reach" ? Math.round(primarySignal).toLocaleString() : formatRate(primarySignal)}</strong></div>
                          <div className={styles.signal}><span>Save rate</span><strong>{formatRate(variantSignals.saveRate)}</strong></div>
                        </div>
                        {publicLink ? <div className={styles.attribution}>Tracked destination: {publicLink}<br />Clicks: {link?.click_count.toLocaleString()} / unique {link?.unique_click_count.toLocaleString()}</div> : null}
                        <div className={styles.variantActions}>
                          {variant.approval_status === "pending" ? <>
                            <form action={approveContentVariant}><input type="hidden" name="variant_id" value={variant.id} /><button className="button primary" type="submit">Approve</button></form>
                            <form action={rejectContentVariant}><input type="hidden" name="variant_id" value={variant.id} /><button className="button" type="submit">Reject</button></form>
                          </> : <span className={variant.approval_status === "approved" ? styles.statusChip : styles.chip}>{variant.approval_status}</span>}
                          {variant.approval_status === "approved" && variant.status !== "published" ? <form action={queueVariantPublication}><input type="hidden" name="variant_id" value={variant.id} /><button className="button" type="submit">Queue publish</button></form> : null}
                        </div>
                        {item ? (
                          <details className={styles.metricForm}>
                            <summary>Add observed metrics</summary>
                            <form action={saveCampaignMetric}>
                              <input type="hidden" name="campaign_id" value={campaign.id} />
                              <input type="hidden" name="release_id" value={release?.id || ""} />
                              <input type="hidden" name="content_item_id" value={item.id} />
                              <input type="hidden" name="content_variant_id" value={variant.id} />
                              <input type="hidden" name="experiment_id" value={experiment.id} />
                              <input type="hidden" name="platform" value={item.platform} />
                              <div className={styles.metricGrid}>
                                <label><span>Date</span><input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
                                {[["reach", "Reach"], ["views", "Views"], ["saves", "Saves"], ["shares", "Shares"], ["profile_visits", "Profile visits"], ["follows", "Follows"], ["link_clicks", "Link clicks"], ["streams", "Streams"], ["playlist_adds", "Playlist adds"]].map(([name, label]) => <label key={name}><span>{label}</span><input type="number" min="0" name={name} defaultValue="0" /></label>)}
                              </div>
                              <button className="button" type="submit">Save snapshot</button>
                            </form>
                          </details>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </article>
            );
          }) : <div className={styles.emptyBrain}><div><h2>No experiments yet</h2><p>Generate a campaign plan to create the first release-specific hypotheses and variants.</p></div></div>}
        </div>
      </section>

      <section>
        <div className={styles.sectionHead}>
          <div><span className={styles.eyebrow}>Release-relative calendar</span><h2>Content timeline</h2></div>
          <p>The timeline stays readable even when no platform publishing API is connected.</p>
        </div>
        <div className={styles.timeline}>
          {content.length ? content.map((item) => {
            const experiment = item.experiment_id ? experimentById.get(item.experiment_id) : undefined;
            return (
              <article className={styles.timelineItem} key={item.id}>
                <div className={styles.timelineDate}><strong>{relativeLabel(item.relative_day)}</strong><br />{formatDate(item.scheduled_at, true)}</div>
                <div><span className={styles.eyebrow}>{item.platform} / {item.format}</span><h4>{item.title}</h4><p>{item.content_angle || item.hook_text || item.goal}{experiment ? ` / Test: ${experiment.title}` : ""}</p></div>
                <span className={item.status === "Published" ? styles.statusChip : styles.chip}>{item.status}</span>
              </article>
            );
          }) : <div className={styles.emptyBrain}><div><h2>No content moments</h2><p>The planner will create a deliberately small release-relative timeline rather than a volume-based content dump.</p></div></div>}
        </div>
      </section>

      <section>
        <div className={styles.sectionHead}>
          <div><span className={styles.eyebrow}>Execution layer</span><h2>Publication queue</h2></div>
          <p>Until a first-party channel adapter is authenticated, Atlas creates a truthful manual-ready handoff instead of pretending a post was published.</p>
        </div>
        <div className={styles.queueList}>
          {publications.length ? publications.map((job) => {
            const details = resultDetails(job.result);
            return (
              <article className={styles.queueItem} key={job.id}>
                <div>
                  <span className={styles.eyebrow}>{job.platform} / {statusLabel(String(job.status))}</span>
                  <h4>{contentById.get(job.content_item_id || "")?.title || "Publication job"}</h4>
                  <p>{job.scheduled_at ? `Target ${formatDate(job.scheduled_at, true)}` : "Publish when ready"}{job.last_error ? ` / ${job.last_error}` : ""}</p>
                  {job.status === ("manual_ready" as never) ? <p>{stringValue(details.hookText)} {stringValue(details.caption)} {stringValue(details.attributionUrl) ? `Tracked link: ${stringValue(details.attributionUrl)}` : ""}</p> : null}
                </div>
                {job.status === ("manual_ready" as never) ? (
                  <details>
                    <summary className="button">Mark published</summary>
                    <form action={markPublicationPublished} className="studio-form">
                      <input type="hidden" name="job_id" value={job.id} />
                      <label className="field"><span>Post URL</span><input type="url" name="external_url" /></label>
                      <label className="field"><span>Platform post ID</span><input name="external_post_id" /></label>
                      <button className="button primary" type="submit">Confirm published</button>
                    </form>
                  </details>
                ) : <span className={styles.chip}>{statusLabel(String(job.status))}</span>}
              </article>
            );
          }) : <div className={styles.emptyBrain}><div><h2>Nothing queued</h2><p>Approve a creative variant first, then queue it for publication.</p></div></div>}
        </div>
      </section>

      {jobs.length ? (
        <section>
          <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Orchestration</span><h2>Automation queue</h2></div><p>Unsafe or consequential actions stop at approval gates in assisted mode.</p></div>
          <div className={styles.queueList}>
            {jobs.map((job) => (
              <article className={styles.queueItem} key={job.id}>
                <div><span className={styles.eyebrow}>{statusLabel(job.status)}</span><h4>{statusLabel(job.job_type)}</h4><p>Attempts {job.attempt_count}/{job.max_attempts}{job.error ? ` / ${job.error}` : ""}</p></div>
                {job.status === "awaiting_approval" ? <form action={approveAutomationJob}><input type="hidden" name="job_id" value={job.id} /><button className="button primary" type="submit">Approve job</button></form> : <span className={styles.chip}>{formatDate(job.run_after, true)}</span>}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className={styles.sectionHead}>
          <div><span className={styles.eyebrow}>Marketing memory</span><h2>Learnings</h2></div>
          <p>Experiment conclusions are proposed first. Only approved learnings become input to future planning.</p>
        </div>
        <div className={styles.learningList}>
          {learnings.length ? learnings.map((learning) => (
            <article className={styles.learning} key={learning.id}>
              <div><span className={styles.eyebrow}>{learning.scope} / {learning.status}</span><p>{learning.finding}</p><div className={styles.learningConfidence}>{Math.round(Number(learning.confidence) * 100)}% confidence</div></div>
              {learning.status === "proposed" ? <div className={styles.inlineActions}>
                <form action={setLearningStatus}><input type="hidden" name="learning_id" value={learning.id} /><input type="hidden" name="status" value="approved" /><button className="button primary" type="submit">Approve learning</button></form>
                <form action={setLearningStatus}><input type="hidden" name="learning_id" value={learning.id} /><input type="hidden" name="status" value="rejected" /><button className="button" type="submit">Reject</button></form>
              </div> : <span className={styles.chip}>{learning.status}</span>}
            </article>
          )) : <div className={styles.emptyBrain}><div><h2>No evidence yet</h2><p>Once experiments accumulate enough observations, Atlas will propose concise reusable learnings here.</p></div></div>}
        </div>
      </section>
    </div>
  );
}
