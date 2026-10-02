import Link from "next/link";
import { ContinueWidget } from "@/components/studio/ux-v4-widgets";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import type { AutoMixJob } from "@/types/automix-database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rootJobId(job: AutoMixJob) {
  const lineage = record(record(job.request_payload).plan_lineage);
  return typeof lineage.root_job_id === "string" ? lineage.root_job_id : job.id;
}

function executionMode(job: AutoMixJob) {
  const mode = record(job.request_payload).execution_mode;
  return typeof mode === "string" ? mode : "render";
}

function executionTarget(job: AutoMixJob) {
  const target = record(job.request_payload).execution_target;
  return target === "device" ? "computer" : "Ensemblis catalog";
}
function status(job: AutoMixJob) {
  if (job.status === "completed") return { label: "Ready", tone: "success" as const };
  if (job.status === "failed") return { label: "Needs attention", tone: "danger" as const };
  if (job.status === "cancelled") return { label: "Cancelled", tone: "neutral" as const };
  return { label: job.status === "planned" ? "Planning" : "Working", tone: "accent" as const };
}

export function MixLibrary({
  artistId,
  jobs,
  query = "",
}: {
  artistId: string;
  jobs: AutoMixJob[];
  query?: string;
}) {
  const groups = new Map<string, AutoMixJob[]>();
  for (const job of jobs) {
    const root = rootJobId(job);
    groups.set(root, [...(groups.get(root) ?? []), job]);
  }

  const mixes = [...groups.entries()].map(([root, revisions]) => {
    const ordered = revisions.toSorted((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    const render = ordered.find((job) => executionMode(job) === "approved_render");
    return { root, job: render ?? ordered[0], revisions: ordered.length };
  }).filter((item): item is { root: string; job: AutoMixJob; revisions: number } => Boolean(item.job))
    .toSorted((left, right) => {
      const leftActive = !["completed", "cancelled"].includes(left.job.status);
      const rightActive = !["completed", "cancelled"].includes(right.job.status);
      return Number(rightActive) - Number(leftActive) || Date.parse(right.job.updated_at) - Date.parse(left.job.updated_at);
    });
  return (
    <section className="en-mix-library" aria-labelledby="mix-library-heading">
      <div className="v2-section-heading">
        <div>
          <span className="section-label">Mixes</span>
          <h2 id="mix-library-heading">Your DJ mix projects</h2>
          <p>One project stays together from music selection through the approved render.</p>
        </div>
        <Link className="button primary" href={ensemblisArtistHref("/studio/music/automix", artistId)}>
          New mix
        </Link>
      </div>

      <form className="music-v5-search" action="/studio/music">
        <input type="hidden" name="artist" value={artistId} />
        <input type="hidden" name="view" value="mixes" />
        <label>
          <span className="sr-only">Search mixes</span>
          <input type="search" name="q" placeholder="Search mixes…" defaultValue={query} autoComplete="off" />
        </label>
        <button className="button" type="submit">Search</button>
        {query ? <Link className="text-button" href={ensemblisArtistHref("/studio/music?view=mixes", artistId)}>Clear</Link> : null}
      </form>

      {mixes.length ? (
        <div className="en-continue-grid">
          {mixes.slice(0, 12).map(({ root, job, revisions }) => {
            const state = status(job);
            const minutes = Math.max(1, Math.round(job.target_duration_ms / 60_000));
            return (
              <ContinueWidget
                key={root}
                eyebrow={`Mix · ${executionTarget(job)}`}
                title={job.name}
                detail={`${job.track_ids.length} tracks · ~${minutes} min · ${revisions} revision${revisions === 1 ? "" : "s"}`}
                status={state.label}
                tone={state.tone}
                href={ensemblisArtistHref(`/studio/music/automix?mix=${encodeURIComponent(root)}&source=${record(job.request_payload).execution_target === "device" ? "local" : "catalog"}`, artistId)}
                actionLabel={job.status === "completed" ? "Open" : "Continue"}
              />
            );
          })}
        </div>
      ) : (
        <div className="v2-calm-state compact">
          <strong>No mixes yet.</strong>
          <p>Start with music from this computer or the Ensemblis catalog.</p>
          <Link className="button primary" href={ensemblisArtistHref("/studio/music/automix", artistId)}>Make a DJ mix</Link>
        </div>
      )}
    </section>
  );
}
