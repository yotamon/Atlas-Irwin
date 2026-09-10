"use client";

import Link from "next/link";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { publishStateLabel, releaseHasHomepageVisibility } from "@/lib/studio/catalog-labels";
import type { HomepagePlacement, Release } from "@/types/database";

type ReleaseWithPlacement = Release & {
  homepage_placements?: HomepagePlacement[] | null;
};

type ReleaseGroup = {
  id: string;
  label: string;
  description: string;
  releases: ReleaseWithPlacement[];
};

function shortDate(value: string | null | undefined) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function groupsFor(releases: ReleaseWithPlacement[]): ReleaseGroup[] {
  const today = new Date().toISOString().slice(0, 10);
  const archived: ReleaseWithPlacement[] = [];
  const upcoming: ReleaseWithPlacement[] = [];
  const live: ReleaseWithPlacement[] = [];
  const catalog: ReleaseWithPlacement[] = [];

  for (const release of releases) {
    if (release.status === "Archived" || release.publish_state === "archived" || release.is_archived) {
      archived.push(release);
    } else if (
      ["Idea", "In Progress", "Scheduled"].includes(release.status)
      || Boolean(release.release_date && release.release_date >= today && release.status !== "Live")
    ) {
      upcoming.push(release);
    } else if (release.status === "Live" || release.publish_state === "live") {
      live.push(release);
    } else {
      catalog.push(release);
    }
  }

  const byDate = (left: ReleaseWithPlacement, right: ReleaseWithPlacement) =>
    String(left.release_date ?? "9999-12-31").localeCompare(String(right.release_date ?? "9999-12-31"));
  upcoming.sort(byDate);
  live.sort((left, right) => String(right.release_date ?? "").localeCompare(String(left.release_date ?? "")));
  catalog.sort((left, right) => String(right.release_date ?? "").localeCompare(String(left.release_date ?? "")));

  return [
    { id: "upcoming", label: "Upcoming", description: "Music still moving toward release day.", releases: upcoming },
    { id: "live", label: "Live", description: "Current releases with active public context.", releases: live },
    { id: "catalog", label: "Catalog", description: "Released music Ensemblis can keep rediscovering.", releases: catalog },
    { id: "archived", label: "Archived", description: "Kept for history, outside the active workflow.", releases: archived },
  ].filter((group) => group.releases.length);
}

export function ReleaseCatalog({
  releases,
  view,
  filters,
  artistId,
}: {
  releases: ReleaseWithPlacement[];
  view: "grid" | "table";
  filters: Record<string, string | undefined>;
  artistId: string;
}) {
  const groups = groupsFor(releases);
  const tableHref = ensemblisArtistHref(`/studio/releases?view=${view === "grid" ? "table" : "grid"}`, artistId);
  const resetHref = ensemblisArtistHref(`/studio/releases?view=${view}`, artistId);

  return (
    <>
      <form className="release-catalog-controls">
        <input type="hidden" name="artist" value={artistId} />
        <input type="hidden" name="view" value={view} />
        <div className="release-catalog-search">
          <input name="q" aria-label="Search releases" placeholder="Search releases" defaultValue={filters.q} />
          <button className="button" type="submit">Search</button>
          <details>
            <summary>Filters</summary>
            <div className="release-catalog-filter-popover">
              <label>
                <span>Workflow</span>
                <select name="status" defaultValue={filters.status}>
                  <option value="">Any status</option>
                  {["Idea", "In Progress", "Scheduled", "Live", "Archived"].map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
              <label>
                <span>Publishing</span>
                <select name="publish" defaultValue={filters.publish}>
                  <option value="">Any publish state</option>
                  {["draft", "scheduled", "live", "archived"].map((state) => <option key={state} value={state}>{publishStateLabel(state)}</option>)}
                </select>
              </label>
              <label>
                <span>Homepage</span>
                <select name="homepage" defaultValue={filters.homepage}>
                  <option value="">Any visibility</option>
                  <option value="visible">On homepage</option>
                  <option value="hidden">Not on homepage</option>
                </select>
              </label>
              <div className="actions">
                <button className="button primary" type="submit">Apply</button>
                <Link className="button" href={resetHref}>Reset</Link>
              </div>
            </div>
          </details>
          <Link className="release-density-toggle" href={tableHref}>{view === "grid" ? "Dense view" : "Visual view"}</Link>
        </div>
      </form>

      {view === "table" ? (
        <div className="release-table-wrap">
          <table className="studio-table">
            <thead><tr><th>Release</th><th>Type</th><th>Workflow</th><th>Publish</th><th>Date</th></tr></thead>
            <tbody>
              {releases.map((release) => (
                <tr key={release.id}>
                  <td><Link href={ensemblisArtistHref(`/studio/releases/${release.id}`, artistId)}><strong>{release.title}</strong><br /><small>{release.slug}</small></Link></td>
                  <td>{release.release_type}</td>
                  <td>{release.status}</td>
                  <td>{publishStateLabel(release.publish_state)}</td>
                  <td>{shortDate(release.release_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="release-catalog-groups">
          {groups.map((group) => (
            <section className="release-catalog-group" key={group.id}>
              <div className="release-catalog-group-head">
                <div><span className="section-label">{group.label}</span><h2>{group.releases.length} release{group.releases.length === 1 ? "" : "s"}</h2><p>{group.description}</p></div>
              </div>
              <div className="release-catalog-list">
                {group.releases.map((release) => (
                  <Link
                    href={ensemblisArtistHref(`/studio/releases/${release.id}`, artistId)}
                    key={release.id}
                    className={`release-catalog-row${release.active_release ? " is-active" : ""}`}
                  >
                    <span className="release-catalog-artwork">
                      {release.artwork_url ? <img src={release.artwork_url} alt={release.cover_alt || ""} /> : release.title.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="release-catalog-copy">
                      <small>{release.release_type} · {shortDate(release.release_date)}</small>
                      <strong>{release.title}</strong>
                      <span>{release.status} · {publishStateLabel(release.publish_state)}{releaseHasHomepageVisibility(release) ? " · Homepage" : ""}</span>
                    </span>
                    {release.active_release ? <span className="release-active-label">Active</span> : null}
                    <span className="release-catalog-arrow" aria-hidden>→</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
