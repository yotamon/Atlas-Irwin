import Link from "next/link";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { distributionProviderConfigured } from "@/lib/distribution/provider";
import { linkDistributionProviderRelease } from "@/app/studio/distribution-actions-safe";

export const metadata = { title: "Distribution Operations" };

type Db = any;

function stateLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default async function DistributionOperations({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; release?: string }>;
}) {
  const feedback = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as Db;
  const [releasesResult, configsResult, submissionsResult, issuesResult, eventsResult] = await Promise.all([
    supabase.from("releases").select("id,title,artist,release_date").eq("owner_id", user.id).eq("is_archived", false).order("updated_at", { ascending: false }),
    db.from("release_distribution_configs").select("*").eq("owner_id", user.id).order("updated_at", { ascending: false }),
    db.from("distribution_submissions").select("*").eq("owner_id", user.id).order("submitted_at", { ascending: false }).limit(20),
    db.from("distribution_validation_issues").select("*").eq("owner_id", user.id).in("status", ["open", "acknowledged"]).order("severity").limit(30),
    db.from("distribution_events").select("*").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(30),
  ]);
  for (const result of [releasesResult, configsResult, submissionsResult, issuesResult, eventsResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const releases = releasesResult.data ?? [];
  const configs = configsResult.data ?? [];
  const submissions = submissionsResult.data ?? [];
  const issues = issuesResult.data ?? [];
  const events = eventsResult.data ?? [];
  const releaseById = new Map(releases.map((release) => [release.id, release]));
  const configByRelease = new Map(configs.map((config: any) => [config.release_id, config]));
  const pendingBridge = releases.filter((release) => !(configByRelease.get(release.id) as any)?.provider_release_id);
  const reviewQueue = configs.filter((config: any) => ["submitted", "under_review"].includes(config.state));
  const operationalErrors = configs.filter((config: any) => ["error", "rejected"].includes(config.state));
  const selectedReleaseId = feedback.release && releases.some((release) => release.id === feedback.release) ? feedback.release : pendingBridge[0]?.id ?? releases[0]?.id ?? "";

  return <div className="distribution-page distribution-operations">
    <header className="distribution-header"><div><Link className="v2-back-link" href="/studio/distribution">← Distribution hub</Link><span className="section-label">Internal only</span><h1>Distribution operations</h1><p>Provider catalog bridging, inspection state, exceptions and audit evidence. Artists should never need this surface.</p></div><span className={`distribution-state ${distributionProviderConfigured() ? "state-live" : "state-error"}`}>{distributionProviderConfigured() ? "Provider connected" : "Credentials missing"}</span></header>

    {feedback.error ? <div className="distribution-feedback error" role="alert"><strong>Action needed</strong><span>{feedback.error}</span></div> : null}
    {feedback.notice ? <div className="distribution-feedback success" role="status"><strong>Done</strong><span>{feedback.notice}</span></div> : null}

    <div className="distribution-stat-grid"><article><strong>{pendingBridge.length}</strong><span>Provider prep</span><small>Release records not linked yet</small></article><article><strong>{reviewQueue.length}</strong><span>In review</span><small>Submitted/provider inspection states</small></article><article><strong>{operationalErrors.length}</strong><span>Operational errors</span><small>Rejected or provider error</small></article><article><strong>{issues.length}</strong><span>Open findings</span><small>Validation and DSP issues</small></article></div>

    <section className="distribution-section distribution-ops-warning"><strong>Provider boundary</strong><p>Ensemblis release data remains canonical. A provider release ID is only an external reference. Do not hand-edit artist-facing release metadata here to make a provider error disappear.</p></section>

    <section className="distribution-section">
      <div className="distribution-section-heading"><div><span className="section-label">Catalog bridge</span><h2>Link a prepared Revelator release</h2><p>This is an explicit temporary operator step until generic credits, identifiers and lossless media upload are fully mapped into provider catalog creation.</p></div></div>
      {releases.length ? <form action={linkDistributionProviderRelease} className="distribution-ops-bridge"><label>Ensemblis release<select name="release_id" defaultValue={selectedReleaseId}>{releases.map((release) => <option value={release.id} key={release.id}>{release.title} · {release.artist}</option>)}</select></label><label>Revelator release ID<input name="provider_release_id" required placeholder="Provider release UUID / ID" /></label><button className="button primary" type="submit">Link provider release</button></form> : <p className="distribution-muted">There are no releases to prepare.</p>}
      {pendingBridge.length ? <div className="distribution-ops-queue">{pendingBridge.slice(0, 12).map((release) => <Link href={`/studio/distribution/operations?release=${release.id}`} key={release.id}><strong>{release.title}</strong><span>{release.artist}</span><small>Provider preparation pending</small></Link>)}</div> : <div className="v2-calm-state compact"><strong>Every current release has a provider catalog reference.</strong><p>New releases will appear here until automated provider preparation is available.</p></div>}
    </section>

    <section className="distribution-section"><div className="distribution-section-heading"><div><span className="section-label">Inspection & exceptions</span><h2>Operational queue</h2></div></div><div className="distribution-ops-table">{configs.filter((config: any) => !["draft", "ready", "live", "taken_down"].includes(config.state)).map((config: any) => { const release = releaseById.get(config.release_id); return <Link href={`/studio/releases/${config.release_id}/distribution`} key={config.release_id}><div><strong>{release?.title ?? config.release_id}</strong><small>{release?.artist ?? "Unknown artist"}</small></div><span className={`distribution-state state-${config.state}`}>{stateLabel(config.state)}</span><small>{config.provider_release_id ? "Provider linked" : "Provider prep pending"}</small><b aria-hidden>→</b></Link>; })}{!configs.some((config: any) => !["draft", "ready", "live", "taken_down"].includes(config.state)) ? <p className="distribution-muted">No release currently needs operational handling.</p> : null}</div></section>

    {issues.length ? <section className="distribution-section distribution-issues"><div className="distribution-section-heading"><div><span className="section-label">Validation findings</span><h2>Open issues</h2></div></div><div className="distribution-issue-list">{issues.map((issue: any) => { const release = releaseById.get(issue.release_id); return <Link href={`/studio/releases/${issue.release_id}/distribution`} className={`issue-${issue.severity}`} key={issue.id}><span>{issue.severity}</span><div><strong>{issue.title}</strong><p>{issue.detail}</p><small>{release?.title ?? issue.release_id} · {issue.source}</small></div></Link>; })}</div></section> : null}

    <section className="distribution-section distribution-history"><div className="distribution-section-heading"><div><span className="section-label">Immutable evidence</span><h2>Recent submissions</h2></div></div>{submissions.length ? submissions.map((submission: any) => { const release = releaseById.get(submission.release_id); return <div key={submission.id}><strong>{release?.title ?? submission.release_id} · v{submission.version}</strong><span>{new Date(submission.submitted_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" })}</span><small>{submission.provider} · {submission.provider_release_id}</small></div>; }) : <p className="distribution-muted">No release has been submitted yet.</p>}</section>

    <section className="distribution-section distribution-history"><div className="distribution-section-heading"><div><span className="section-label">Audit log</span><h2>Recent distribution events</h2></div></div>{events.length ? events.map((event: any) => <div key={event.id}><strong>{stateLabel(event.event_type.replace("distribution.", ""))}</strong><span>{new Date(event.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" })}</span><small>{event.actor_type}{event.release_id ? ` · ${releaseById.get(event.release_id)?.title ?? event.release_id}` : ""}</small></div>) : <p className="distribution-muted">No distribution events yet.</p>}</section>
  </div>;
}
