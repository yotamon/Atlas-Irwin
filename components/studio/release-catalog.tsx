"use client";

import Link from "next/link";
import type { HomepagePlacement, Release } from "@/types/database";
import { publishStateLabel, releaseHasHomepageVisibility } from "@/lib/studio/catalog-labels";
import { Status } from "@/components/studio/ui";

type ReleaseWithPlacement = Release & {
  homepage_placements?: HomepagePlacement[] | null;
};

export function ReleaseCatalog({
  releases,
  view,
  filters,
}: {
  releases: ReleaseWithPlacement[];
  view: "grid" | "table";
  filters: Record<string, string | undefined>;
}) {
  return (
    <>
      <form className="studio-tabs catalog-filters">
        <input name="q" placeholder="Search releases" defaultValue={filters.q} />
        <select name="status" defaultValue={filters.status}>
          <option value="">All workflow statuses</option>
          {["Idea", "In Progress", "Scheduled", "Live", "Archived"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="publish" defaultValue={filters.publish}>
          <option value="">All publish states</option>
          {["draft", "scheduled", "live", "archived"].map((s) => (
            <option key={s} value={s}>
              {publishStateLabel(s)}
            </option>
          ))}
        </select>
        <select name="homepage" defaultValue={filters.homepage}>
          <option value="">Homepage visibility</option>
          <option value="visible">On homepage</option>
          <option value="hidden">Not on homepage</option>
        </select>
        <input type="hidden" name="view" value={view} />
        <button className="button">Filter</button>
        <Link
          className="button"
          href={`/studio/releases?view=${view === "grid" ? "table" : "grid"}`}
        >
          {view === "grid" ? "Table view" : "Grid view"}
        </Link>
      </form>
      {view === "table" ? (
        <table className="studio-table">
          <thead>
            <tr>
              <th>Release</th>
              <th>Type</th>
              <th>Publish</th>
              <th>Homepage</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {releases.map((release) => (
              <tr key={release.id}>
                <td>
                  <Link href={`/studio/releases/${release.id}`}>
                    <strong>{release.title}</strong>
                    <br />
                    <small>{release.slug}</small>
                  </Link>
                </td>
                <td>{release.release_type}</td>
                <td>
                  <Status>{publishStateLabel(release.publish_state)}</Status>
                </td>
                <td>
                  {releaseHasHomepageVisibility(release) ? (
                    <Status>Homepage</Status>
                  ) : (
                    "Hidden"
                  )}
                </td>
                <td>
                  {release.release_date
                    ? new Date(release.release_date).toLocaleDateString()
                    : "Unscheduled"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="catalog-grid">
          {releases.map((release) => (
            <Link
              href={`/studio/releases/${release.id}`}
              key={release.id}
              className="catalog-card"
            >
              {release.artwork_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={release.artwork_url} alt="" />
              ) : (
                <div className="empty-orbit" />
              )}
              <div className="catalog-card-body">
                <div className="catalog-card-badges">
                  <Status>{publishStateLabel(release.publish_state)}</Status>
                  {releaseHasHomepageVisibility(release) && (
                    <Status>Homepage</Status>
                  )}
                  {release.active_release && <Status>Active</Status>}
                </div>
                <h3>{release.title}</h3>
                <p>
                  {release.release_type}
                  {release.release_date
                    ? ` · ${new Date(release.release_date).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
