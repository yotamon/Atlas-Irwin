import Link from "next/link";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ReleaseVideoPanel } from "@/components/studio/video-director/release-video-panel";
import { EmptyState, PageHeader } from "@/components/studio/ui";

function dateLabel(value: string | null) {
  if (!value) return "Release date not set";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(`${value}T12:00:00+02:00`));
}

export default async function VideoDirectorPage({
  searchParams,
}: {
  searchParams: Promise<{ release?: string }>;
}) {
  const { supabase, user } = await requireStudioAdmin();
  const params = await searchParams;
  const [releasesResult, tracksResult, projectsResult] = await Promise.all([
    supabase
      .from("releases")
      .select("*")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("tracks")
      .select("*")
      .eq("owner_id", user.id)
      .order("display_order"),
    supabase
      .from("music_video_projects")
      .select("*")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false }),
  ]);

  if (releasesResult.error) throw new Error(releasesResult.error.message);
  if (tracksResult.error) throw new Error(tracksResult.error.message);
  if (projectsResult.error) throw new Error(projectsResult.error.message);

  const releases = releasesResult.data ?? [];
  const tracks = tracksResult.data ?? [];
  const projects = projectsResult.data ?? [];
  const requestedRelease = params.release
    ? releases.find((release) => release.id === params.release)
    : null;
  const firstReleaseWithMusic = releases.find((release) =>
    tracks.some((track) => track.release_id === release.id),
  );
  const selectedRelease = requestedRelease ?? firstReleaseWithMusic ?? releases[0] ?? null;
  const selectedTracks = selectedRelease
    ? tracks.filter((track) => track.release_id === selectedRelease.id)
    : [];
  const selectedProjects = selectedRelease
    ? projects.filter((project) => project.release_id === selectedRelease.id)
    : [];

  return (
    <>
      <PageHeader
        title="Video Director"
        description="Turn a canonical Atlas track into a planned music-video production. Project setup is free; paid generation stays behind explicit budget approvals."
        action={
          <Link className="button" href="/studio/create">
            Back to Create
          </Link>
        }
      />

      {!releases.length ? (
        <EmptyState
          title="Create a release first"
          body="Video Director starts from a canonical release and track so every concept, shot, asset, cost and final render stays attached to the music."
          href="/studio/releases/new"
          label="Create release"
        />
      ) : (
        <div className="workspace-stack video-release-panel">
          <section className="workspace-section">
            <div className="section-head">
              <div>
                <span className="section-label">Choose the music</span>
                <h2>Release context</h2>
              </div>
              <span>{projects.length} video project{projects.length === 1 ? "" : "s"} total</span>
            </div>
            <div className="video-project-grid">
              {releases.map((release) => {
                const releaseTracks = tracks.filter((track) => track.release_id === release.id);
                const releaseProjects = projects.filter((project) => project.release_id === release.id);
                const active = selectedRelease?.id === release.id;
                return (
                  <Link
                    href={`/studio/video?release=${release.id}`}
                    className="video-project-card"
                    aria-current={active ? "page" : undefined}
                    key={release.id}
                  >
                    <span className="section-label">{active ? "Selected release" : "Release"}</span>
                    <h3>{release.title}</h3>
                    <p>{dateLabel(release.release_date)}</p>
                    <div className="video-project-card-meta">
                      <span>{releaseTracks.length} track{releaseTracks.length === 1 ? "" : "s"}</span>
                      <span>{releaseProjects.length} video{releaseProjects.length === 1 ? "" : "s"}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {selectedRelease ? (
            <ReleaseVideoPanel
              release={selectedRelease}
              tracks={selectedTracks}
              projects={selectedProjects}
            />
          ) : null}
        </div>
      )}
    </>
  );
}
