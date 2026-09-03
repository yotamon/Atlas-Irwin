import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { distributionProviderConfigured } from "@/lib/distribution/provider";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { linkDistributionProviderRelease } from "@/app/studio/distribution-actions-safe";
import type { DistributionDatabase } from "@/types/distribution-database";

export const metadata = { title: "Distribution Operations" };

type Db = SupabaseClient<DistributionDatabase>;

function stateLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export default async function DistributionOperations({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; release?: string }>;
}) {
  const feedback = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const db = supabase as unknown as Db;
  const [releasesResult, configsResult, submissionsResult, issuesResult, eventsResult, operationsResult] = await Promise.all([
    db.from("releases").select("id,title,artist,release_date").eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("is_archived", false).order("updated_at", { ascending: false }),
    db.from("release_distribution_configs").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("updated_at", { ascending: false }),
    db.from("distribution_submissions").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("submitted_at", { ascending: false }).limit(20),
    db.from("distribution_validation_issues").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).in("status", ["open", "acknowledged"]).order("severity").limit(30),
    db.from("distribution_events").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("created_at", { ascending: false }).limit(30),
    db.from("distribution_provider_operations").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("created_at", { ascending: false }).limit(50),
  ]);
  for (const result of [releasesResult, configsResult, submissionsResult, issuesResult, eventsResult, operationsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const releases = releasesResult.data ?? [];
  const configs = configsResult.data ?? [];
  const submissions = submissionsResult.data ?? [];
  const issues = issuesResult.data ?? [];
  const events = eventsResult.data ?? [];
  const operations = operationsResult.data ?? [];
  const releaseById = new Map(releases.map((release) => [release.id, release]));
  const configByRelease = new Map(configs.map((config) => [config.release_id, config]));
  const unresolved = operations.filter((operation) => ["started", "ambiguous"].includes(operation.state));
  const unresolvedCatalog = unresolved.filter((operation) => ["prepare_catalog", "update_catalog"].includes(operation.operation_type));
  const unresolvedSubmit = unresolved.filter((operation) => operation.operation_type === "submit");
  const reviewQueue = configs.filter((config) => ["submitted", "under_review"].includes(config.state));
  const operationalErrors = configs.filter((config) => ["error", "rejected"].includes(config.state));
  const unprepared = releases.filter((release) => !configByRelease.get(release.id)?.provider_release_id);
  const recoveryCandidates = new Set([...unresolvedCatalog.map((operation) => operation.release_id), ...unprepared.map((release) => release.id)]);
  const selectedReleaseId = feedback.release && recoveryCandidates.has(feedback.release)
    ? feedback.release
    : unresolvedCatalog[0]?.release_id ?? unprepared[0]?.id ?? releases[0]?.id ?? "";

  return <div className="distribution-page distribution-operations">
    <header className="distribution-header"><div><Link className="v2-back-link" href="/studio/distribution">← Distribution hub</Link><span className="section-label">Internal operations · {artist.artistName}</span><h1>Distribution operations</h1><p>Exception handling, ambiguous external writes, provider review state and immutable audit evidence for the active artist. Normal release preparation happens in the artist workspace.</p></div><span className={`distribution-state ${distributionProviderConfigured() ? "state-live" : "state-error"}`}>{distributionProviderConfigured() ? "Provider connected" : "Credentials missing"}</span></header>

    {feedback.error ? <div className="distribution-feedback error" role="alert"><strong>Action needed</strong><span>{feedback.error}</span></div> : null}
    {feedback.notice ? <div className="distribution-feedback success" role="status"><strong>Reconciled</strong><span>{feedback.notice}</span></div> : null}

    <div className="distribution-stat-grid"><article><strong>{unresolved.length}</strong><span>Unresolved operations</span><small>Automatic retries are blocked</small></article><article><strong>{unresolvedSubmit.length}</strong><span>Ambiguous submissions</span><small>Reconcile against provider state</small></article><article><strong>{reviewQueue.length}</strong><span>In review</span><small>Submitted or inspection state</small></article><article><strong>{operationalErrors.length}</strong><span>Exceptions</span><small>Rejected or provider error</small></article></div>

    <section className="distribution-section distribution-ops-warning"><strong>Safety boundary</strong><p>Ensemblis remains canonical. Never create or submit a second provider record just to clear an uncertain network result. Reconcile the existing external operation first.</p></section>

    <section className="distribution-section">
      <div className="distribution-section-heading"><div><span className="section-label">Uncertain external writes</span><h2>{unresolved.length ? `${unresolved.length} operation${unresolved.length === 1 ? "" : "s"} need reconciliation` : "No ambiguous provider operations"}</h2><p>An operation remains blocked until provider evidence makes its outcome safe to classify.</p></div></div>
      {unresolved.length ? <div className="distribution-ops-table">{unresolved.map((operation) => { const release = releaseById.get(operation.release_id); return <Link href={`/studio/releases/${operation.release_id}/distribution`} key={operation.id}><div><strong>{release?.title ?? operation.release_id}</strong><small>{stateLabel(operation.operation_type)} · {operation.error || "Outcome not confirmed"}</small></div><span className={`distribution-state state-${operation.state === "ambiguous" ? "error" : "under_review"}`}>{stateLabel(operation.state)}</span><small>{operation.provider_resource_id ? "External resource known" : "External resource unknown"}</small><b aria-hidden>→</b></Link>; })}</div> : <div className="v2-calm-state compact"><strong>No external mutation is in an uncertain state.</strong><p>Normal catalog preparation and submission can continue from each release.</p></div>}
    </section>

    <section className="distribution-section">
      <div className="distribution-section-heading"><div><span className="section-label">Recovery only</span><h2>Reconcile an existing provider release ID</h2><p>Use this only after ambiguous provider creation or when migrating a pre-existing catalog record. It is not the normal preparation path.</p></div></div>
      {releases.length ? <form action={linkDistributionProviderRelease} className="distribution-ops-bridge"><input type="hidden" name="artist_id" value={artist.artistId} /><label>Ensemblis release<select name="release_id" defaultValue={selectedReleaseId}>{releases.map((release) => <option value={release.id} key={release.id}>{release.title} · {release.artist}</option>)}</select></label><label>Existing provider release ID<input name="provider_release_id" required placeholder="External release ID to reconcile" /></label><button className="button" type="submit">Reconcile existing record</button></form> : <p className="distribution-muted">There are no releases to reconcile.</p>}
      {unprepared.length ? <div className="distribution-ops-queue">{unprepared.slice(0, 12).map((release) => <Link href={`/studio/releases/${release.id}/distribution`} key={release.id}><strong>{release.title}</strong><span>{release.artist}</span><small>Not prepared yet · use the normal artist workflow unless this is a recovery case</small></Link>)}</div> : null}
    </section>

    <section className="distribution-section"><div className="distribution-section-heading"><div><span className="section-label">Inspection & exceptions</span><h2>Operational queue</h2></div></div><div className="distribution-ops-table">{configs.filter((config) => !["draft", "ready", "live", "taken_down"].includes(config.state)).map((config) => { const release = releaseById.get(config.release_id); return <Link href={`/studio/releases/${config.release_id}/distribution`} key={config.release_id}><div><strong>{release?.title ?? config.release_id}</strong><small>{release?.artist ?? "Unknown artist"}</small></div><span className={`distribution-state state-${config.state}`}>{stateLabel(config.state)}</span><small>{config.provider_release_id ? "Catalog synchronized" : "Package not prepared"}</small><b aria-hidden>→</b></Link>; })}{!configs.some((config) => !["draft", "ready", "live", "taken_down"].includes(config.state)) ? <p className="distribution-muted">No release currently needs operational handling.</p> : null}</div></section>

    {issues.length ? <section className="distribution-section distribution-issues"><div className="distribution-section-heading"><div><span className="section-label">Validation findings</span><h2>Open issues</h2></div></div><div className="distribution-issue-list">{issues.map((issue) => { const release = releaseById.get(issue.release_id); return <Link href={`/studio/releases/${issue.release_id}/distribution`} className={`issue-${issue.severity}`} key={issue.id}><span>{issue.severity}</span><div><strong>{issue.title}</strong><p>{issue.detail}</p><small>{release?.title ?? issue.release_id} · {issue.source}</small></div></Link>; })}</div></section> : null}

    <section className="distribution-section distribution-history"><div className="distribution-section-heading"><div><span className="section-label">Immutable evidence</span><h2>Recent submissions</h2></div></div>{submissions.length ? submissions.map((submission) => { const release = releaseById.get(submission.release_id); return <div key={submission.id}><strong>{release?.title ?? submission.release_id} · v{submission.version}</strong><span>{new Date(submission.submitted_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" })}</span><small>{submission.provider} · {submission.provider_release_id}</small></div>; }) : <p className="distribution-muted">No release has been submitted yet.</p>}</section>

    <section className="distribution-section distribution-history"><div className="distribution-section-heading"><div><span className="section-label">Audit log</span><h2>Recent distribution events</h2></div></div>{events.length ? events.map((event) => <div key={event.id}><strong>{stateLabel(event.event_type.replace("distribution.", ""))}</strong><span>{new Date(event.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" })}</span><small>{event.actor_type}{event.release_id ? ` · ${releaseById.get(event.release_id)?.title ?? event.release_id}` : ""}</small></div>) : <p className="distribution-muted">No distribution events yet.</p>}</section>
  </div>;
}
