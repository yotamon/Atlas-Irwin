import Link from "next/link";
import { startOutcomeCreative } from "@/app/studio/create-actions";
import { PageHeader, Status } from "@/components/studio/ui";
import { TrackPreview } from "@/components/studio/track-preview";
import { creativeSourceHierarchy } from "@/lib/artist-operating/domain";
import { loadArtistOperatingContext } from "@/lib/artist-operating/server";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { requireArtistContext } from "@/lib/studio/artist-context";
import { recommendCreativeDirections } from "@/lib/studio/creative-directions";
import { momentEvidenceSummary } from "@/lib/studio/evidence-labels";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { curateReleaseMoments } from "@/lib/studio/moments-curator";
import { asMomentsClient } from "@/lib/studio/moments-db";
import { createClient } from "@/lib/supabase/server";

function momentTime(ms: number) {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function deliverableLabel(platform: string, format: string) {
  return `${platform} ${format}`.replace(/Instagram Instagram/i, "Instagram");
}

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ track?: string; release?: string }> }) {
  const params = await searchParams;
  const artist = await requireArtistContext();
  const supabase = await createClient();
  const music = asArtistScopedMusicClient(supabase);
  const momentsDb = asMomentsClient(supabase);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  const [operatingContext, momentsResult, releasesResult, tracksResult] = await Promise.all([
    loadArtistOperatingContext({ db: supabase, artist }),
    momentsDb.from("moments").select("*").eq("artist_id", artist.artistId).eq("state", "approved").order("confidence", { ascending: false }).order("start_ms", { ascending: true }).limit(24),
    music.from("releases").select("id,title,release_date,active_release").eq("owner_id", artist.userId).eq("artist_id", artist.artistId).order("updated_at", { ascending: false }),
    music.from("tracks").select("id,title,release_id,audio_url,is_primary").eq("owner_id", artist.userId).eq("artist_id", artist.artistId),
  ]);
  const firstError = [momentsResult, releasesResult, tracksResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const releases = releasesResult.data ?? [];
  const tracks = tracksResult.data ?? [];
  const releaseById = new Map(releases.map((release) => [release.id, release]));
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const requestedTrack = params.track ? trackById.get(params.track) ?? null : null;
  const requestedReleaseId = params.release ?? requestedTrack?.release_id ?? null;
  const activeRelease = (requestedReleaseId ? releases.find((release) => release.id === requestedReleaseId) : null)
    ?? releases.find((release) => release.active_release)
    ?? releases.find((release) => release.release_date && release.release_date >= new Date().toISOString().slice(0, 10))
    ?? releases[0]
    ?? null;
  const curation = curateReleaseMoments({ moments: momentsResult.data ?? [] });
  const requestedMoments = params.track ? curation.curated.filter((moment) => moment.track_id === params.track) : curation.curated;
  const directionMoments = requestedMoments.length ? requestedMoments : curation.curated;
  const directions = recommendCreativeDirections({ moments: directionMoments, activeReleaseId: activeRelease?.id ?? null });
  const sourceHierarchy = creativeSourceHierarchy(operatingContext.profile);

  const otherStartingPoints = [
    {
      title: operatingContext.profile.aiPolicy.musicAllowed ? "Add or create music" : "Add music",
      description: operatingContext.profile.aiPolicy.musicAllowed
        ? "Bring in a master or create a musical draft when source music does not exist yet."
        : "Bring in the artist's existing master. AI music creation is disabled for this artist.",
      href: href("/studio/music?view=add"),
    },
    { title: "Start a release", description: "Create the release identity before campaign creative exists.", href: href("/studio/releases/new") },
    { title: "Continue production", description: "Open work that is already in progress.", href: href("/studio/production") },
    {
      title: "Direct a longer video",
      description: operatingContext.profile.aiPolicy.visualsAllowed
        ? "Use Video Director for a larger coherent music video, still grounded in artist identity and musical evidence."
        : "Use Video Director with source media, artwork and deterministic treatments; generative visuals are disabled for this artist.",
      href: href(activeRelease ? `/studio/video?release=${activeRelease.id}` : "/studio/video"),
    },
  ];

  return (
    <div className="studio-v2-page create-polish-page ensemblis-create-page">
      <PageHeader
        title="Create"
        description="Choose the deliverable. Ensemblis chooses the strongest musical source and carries the artist context with it."
        action={requestedTrack ? <Link className="button" href={href(`/studio/music/${requestedTrack.id}`)}>Back to track</Link> : undefined}
      />

      {activeRelease ? (
        <section className="create-context-strip" aria-label="Creative context">
          <div>
            <span className="section-label">Creating for</span>
            <strong>{activeRelease.title}</strong>
            <small>{requestedTrack ? requestedTrack.title : "Best approved musical Moments"}</small>
          </div>
          <Link href={href(`/studio/releases/${activeRelease.id}?stage=music#moments`)}>Review source Moments</Link>
        </section>
      ) : null}

      {directions.length ? (
        <section className="create-deliverable-section">
          <div className="v2-section-heading">
            <div>
              <span className="section-label">Recommended for this music</span>
              <h2>What do you want to make?</h2>
              <p>Three strong options, already paired with the musical Moment most likely to make each one work.</p>
            </div>
          </div>

          <div className="create-deliverable-grid">
            {directions.map((direction) => {
              const moment = direction.moment;
              const release = releaseById.get(moment.release_id);
              const track = trackById.get(moment.track_id);
              const startSeconds = Math.max(0, moment.start_ms / 1000);
              const endSeconds = Math.max(startSeconds, moment.end_ms / 1000);
              const evidence = momentEvidenceSummary(moment);
              return (
                <article className={`create-deliverable-card${direction.rank === 1 ? " is-recommended" : ""}`} key={direction.id}>
                  <div className="create-deliverable-head">
                    <span>{deliverableLabel(direction.outcome.platform, direction.outcome.format)}</span>
                    {direction.rank === 1 ? <Status>Best next option</Status> : null}
                  </div>
                  <h3>{direction.outcome.shortLabel}</h3>
                  <p>{direction.outcome.description}</p>

                  <div className="create-source-preview">
                    <span className="section-label">Ensemblis picked</span>
                    <strong>{moment.label}</strong>
                    <small>{track?.title || "Track"} · {momentTime(moment.start_ms)}–{momentTime(moment.end_ms)}</small>
                    {track?.audio_url ? <TrackPreview src={track.audio_url} startSeconds={startSeconds} endSeconds={endSeconds} label={moment.label} compact /> : null}
                  </div>

                  <p className="create-direction-rationale">{direction.rationale}</p>
                  <form action={startOutcomeCreative} className="create-direction-action">
                    <input type="hidden" name="artist_id" value={artist.artistId} />
                    <input type="hidden" name="moment_id" value={moment.id} />
                    <input type="hidden" name="outcome" value={direction.outcome.id} />
                    <button className="button primary" type="submit" title={`Create ${direction.outcome.format}`}>Create {direction.outcome.format}</button>
                  </form>

                  <details className="create-evidence-details">
                    <summary>Why this source?</summary>
                    <p>{evidence || "Selected from the strongest complete musical passages for this release."}</p>
                    <small>{release?.title || "Release"} · musical evidence stays attached through production.</small>
                  </details>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="v2-section">
          <div className="v2-calm-state compact">
            <strong>No strong musical source is ready yet.</strong>
            <p>Add and analyze music first. Ensemblis will wait for real musical evidence rather than manufacture generic content.</p>
            <Link className="button primary" href={href("/studio/music?view=add")}>Add music</Link>
          </div>
        </section>
      )}

      <aside className="create-next-action-callout">
        <div>
          <span className="section-label">Not sure?</span>
          <strong>Use the first recommendation.</strong>
          <p>It is the best current match between the music, the artist and a useful deliverable.</p>
        </div>
        <Link className="button" href={href("/studio")}>Back to Today</Link>
      </aside>

      <details className="v2-advanced-disclosure create-specialist-tools">
        <summary>Other ways to create</summary>
        <div className="create-specialist-links">{otherStartingPoints.map((item) => <Link href={item.href} key={item.title}>{item.title}<span>{item.description}</span></Link>)}</div>
        <div className="create-policy-note">
          <span className="section-label">Artist creative policy</span>
          <p>{sourceHierarchy.slice(0, 6).join(" → ")}</p>
          <Link href={href("/studio/settings/artist")}>Review artist policy</Link>
        </div>
      </details>
    </div>
  );
}
