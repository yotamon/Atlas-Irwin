import Link from "next/link";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { buildReleaseRunway, type RunwayRelease } from "@/lib/studio/release-runway";

function berlinToday(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function friendlyDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function ReleaseRunway({ releases, artistId, renderedAt }: {
  releases: RunwayRelease[];
  artistId: string;
  renderedAt: string;
}) {
  const today = berlinToday(new Date(renderedAt));
  const entries = buildReleaseRunway(releases, today);
  const href = (path: string) => ensemblisArtistHref(path, artistId);

  return (
    <section className="v2-section v2-compact-section release-runway" aria-labelledby="release-runway-title">
      <div className="v2-section-heading">
        <div>
          <span className="section-label">Release runway</span>
          <h2 id="release-runway-title">Your upcoming music</h2>
          <p>See release spacing and suggested preparation milestones. This is planning, not distributor confirmation.</p>
        </div>
        <Link className="button" href={href("/studio/releases/new")}>Plan a release</Link>
      </div>

      {entries.length ? (
        <div className="v2-simple-list">
          {entries.map((entry) => (
            <article className="v2-plan-card" key={entry.id}>
              <div>
                <span>{friendlyDate(entry.date)} · {entry.daysUntil === 0 ? "Today" : `In ${entry.daysUntil} days`}</span>
                <h3><Link href={href(`/studio/releases/${entry.id}`)}>{entry.title}</Link></h3>
                <p>{entry.spacingWarning
                  ? `Only ${entry.spacingDays} day${entry.spacingDays === 1 ? "" : "s"} from another planned release. Review whether both launches will get enough attention.`
                  : entry.spacingDays === null
                    ? "No adjacent planned release to compare."
                    : `Nearest planned release is ${entry.spacingDays} days away.`}</p>
                {entry.preparationWindowShort ? (
                  <small>Less than 21 days remain. Check distributor lead time and the actual artist approval state.</small>
                ) : null}
              </div>
              <div>
                {entry.milestones.map((milestone) => (
                  <p key={milestone.kind}>
                    <strong>{friendlyDate(milestone.date)} · {milestone.title}</strong><br />
                    <small>{milestone.detail}</small>
                  </p>
                ))}
                <Link className="button" href={href(`/studio/releases/${entry.id}`)}>Open release plan →</Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="v2-calm-state compact">
          <strong>No upcoming releases scheduled.</strong>
          <p>Choose a track from Music and create a release with a target date. Ensemblis will show preparation milestones without scheduling public actions on your behalf.</p>
          <Link className="button" href={href("/studio/music")}>Choose music →</Link>
        </div>
      )}
    </section>
  );
}
