import Link from "next/link";
import { ReleaseVideoPanel } from "@/components/studio/video-director/release-video-panel";
import { EmptyState, PageHeader } from "@/components/studio/ui";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { requireArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asMomentsClient } from "@/lib/studio/moments-db";
import { createClient } from "@/lib/supabase/server";

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
  const artist = await requireArtistContext();
  const supabase = await createClient();
  const music = asArtistScopedMusicClient(supabase);
  const momentsDb = asMomentsClient(supabase);
  const params = await searchParams;
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  const [releasesResult, tracksResult, projectsResult, momentsResult] = await Promise.all([
    music
      .from("releases")
      .select("*")
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .order("updated_at", { ascending: false }),
    music
      .from("tracks")
      .select("*")
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .order("display_order"),
    supabase
      .from("music_video_projects")
      .select("*")
      .eq("owner_id", artist.userId)
      .order("updated_at", { ascending: false }),
    momentsDb
      .from("moments")
      .select("*")
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .eq("state", "approved")
      .order("confidence", { ascending: false })
      .order("start_ms", { ascending: true })
      .limit(30),
  ]);

  if (releasesResult.error) throw new Error(releasesResult.error.message);
  if (tracksResult.error) throw new Error(tracksResult.error.message);
  if (projectsResult.error) throw new Error(projectsResult.error.message);
  if (momentsResult.error) throw new Error(momentsResult.error.message);

  const releases = releasesResult.data ?? [];
  const tracks = tracksResult.data ?? [];
  const releaseIds = new Set(releases.map((release) => release.id));
  const projects = (projectsResult.data ?? []).filter((project) => releaseIds.has(project.release_id));
  const moments = momentsResult.data ?? [];
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
  const selectedMoments = selectedRelease
    ? moments.filter((moment) => moment.release_id === selectedRelease.id)
    : [];

  return (
    <>
      <PageHeader
        title="Video"
        description={`Turn ${artist.artistName}'s music into a coherent video without managing a production pipeline. Quick Video starts with three music-aware directions; Director Pro remains available when you want the controls.`}
        action={
          <Link className="button" href={href("/studio/create")}>
            Back to Create
          </Link>
        }
      />

      {!releases.length ? (
        <EmptyState
          title="Create a release first"
          body="Video starts from a canonical release and track so every concept, Moment, asset, cost and final render stays attached to the music."
          href={href("/studio/releases/new")}
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
              <span>{projects.length} video project{projects.length === 1 ? "" : "s"} for this artist</span>
            </div>
            <div className="video-project-grid">
              {releases.map((release) => {
                const releaseTracks = tracks.filter((track) => track.release_id === release.id);
                const releaseProjects = projects.filter((project) => project.release_id === release.id);
                const active = selectedRelease?.id === release.id;
                return (
                  <Link
                    href={href(`/studio/video?release=${release.id}`)}
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
              moments={selectedMoments}
            />
          ) : null}
        </div>
      )}
    </>
  );
}
