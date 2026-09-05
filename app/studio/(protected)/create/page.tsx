import Link from "next/link";
import { startOutcomeCreative } from "@/app/studio/create-actions";
import { PageHeader } from "@/components/studio/ui";
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

export default async function CreatePage() {
  const artist = await requireArtistContext();
  const supabase = await createClient();
  const music = asArtistScopedMusicClient(supabase);
  const momentsDb = asMomentsClient(supabase);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  const [momentsResult, releasesResult, tracksResult] = await Promise.all([
    momentsDb
      .from("moments")
      .select("*")
      .eq("artist_id", artist.artistId)
      .eq("state", "approved")
      .order("confidence", { ascending: false })
      .order("start_ms", { ascending: true })
      .limit(24),
    music
      .from("releases")
      .select("id,title,release_date,active_release")
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .order("updated_at", { ascending: false }),
    music
      .from("tracks")
      .select("id,title,release_id,audio_url,is_primary")
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId),
  ]);
  const firstError = [momentsResult, releasesResult, tracksResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const releases = releasesResult.data ?? [];
  const tracks = tracksResult.data ?? [];
  const releaseById = new Map(releases.map((release) => [release.id, release]));
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const activeRelease = releases.find((release) => release.active_release)
    ?? releases.find((release) => release.release_date && release.release_date >= new Date().toISOString().slice(0, 10))
    ?? releases[0]
    ?? null;
  const curation = curateReleaseMoments({ moments: momentsResult.data ?? [] });
  const directions = recommendCreativeDirections({
    moments: curation.curated,
    activeReleaseId: activeRelease?.id ?? null,
  });

  const otherStartingPoints = [
    {
      title: "Add or create music",
      description: "Bring in a master or create a musical draft when the source music does not exist yet.",
      href: href("/studio/music?view=add"),
    },
    {
      title: "Start a release",
      description: "Create the canonical release identity before campaign creative exists.",
      href: href("/studio/releases/new"),
    },
    {
      title: "Open the production queue",
      description: "Inspect or continue existing creative work without choosing a new musical starting point.",
      href: href("/studio/production"),
    },
    {
      title: "Direct a video",
      description: "Use Video Director when the outcome is a larger coherent music video rather than a campaign asset.",
      href: href(activeRelease ? `/studio/video?release=${activeRelease.id}` : "/studio/video"),
    },
  ];

  return (
    <div className="studio-v2-page create-polish-page">
      <PageHeader
        title="Create"
        description={`Ensemblis has already listened to ${artist.artistName}'s music. Start from the three strongest creative directions, not a matrix of tools and settings.`}
      />

      {directions.length ? (
        <section className="v2-section">
          <div className="v2-section-heading">
            <div>
              <span className="section-label">Recommended musical starting points · three strongest directions</span>
              <h2>Choose the creative idea, not the production machinery</h2>
            </div>
            {activeRelease ? <Link href={href(`/studio/releases/${activeRelease.id}?stage=create#moments`)}>Review source Moments</Link> : null}
          </div>
          <p className="v2-muted-copy">
            Each direction is an evidence-backed musical starting point ranked from approved Moments and their hook, vocal, emotional, energy and uniqueness signals. Create from this Moment without choosing providers, prompts or production plumbing first.
          </p>

          <div className="growth-opportunity-grid create-moment-grid">
            {directions.map((direction) => {
              const moment = direction.moment;
              const release = releaseById.get(moment.release_id);
              const track = trackById.get(moment.track_id);
              const startSeconds = Math.max(0, moment.start_ms / 1000);
              const endSeconds = Math.max(startSeconds, moment.end_ms / 1000);
              const evidence = momentEvidenceSummary(moment);
              return (
                <article className="growth-opportunity accepted create-moment-card" key={direction.id}>
                  <div className="growth-opportunity-head">
                    <span>Direction {direction.rank}</span>
                    {direction.rank === 1 ? <strong>Recommended</strong> : <strong>{direction.outcome.label}</strong>}
                  </div>
                  <h3>{direction.outcome.shortLabel}</h3>
                  <p>{direction.rationale}</p>
                  <small><strong>Source Moment:</strong> {moment.label}</small>
                  {evidence ? <small>Why: {evidence}</small> : null}
                  <small>
                    {release?.title || "Release"} · {track?.title || "Track"} · {momentTime(moment.start_ms)}–{momentTime(moment.end_ms)}
                  </small>
                  {track?.audio_url ? (
                    <audio
                      className="music-workspace-audio"
                      controls
                      preload="metadata"
                      src={`${track.audio_url}#t=${startSeconds.toFixed(2)},${endSeconds.toFixed(2)}`}
                    />
                  ) : null}

                  <form action={startOutcomeCreative} className="create-direction-action">
                    <input type="hidden" name="artist_id" value={artist.artistId} />
                    <input type="hidden" name="moment_id" value={moment.id} />
                    <input type="hidden" name="outcome" value={direction.outcome.id} />
                    <button className="button primary" type="submit" title="Create from this Moment">Create this direction</button>
                  </form>
                  <div className="actions create-evidence-action">
                    <Link className="button" href={href(`/studio/releases/${moment.release_id}?stage=create#moments`)}>Inspect evidence</Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="v2-section">
          <div className="v2-calm-state compact">
            <strong>No approved musical Moment is ready yet.</strong>
            <p>Add and analyze music first. Ensemblis will not invent a hook just to make the creation screen look busy.</p>
            <Link className="button primary" href={href("/studio/music?view=add")}>Add music</Link>
          </div>
        </section>
      )}

      <aside className="create-next-action-callout">
        <div>
          <span className="section-label">Not sure what to make?</span>
          <strong>Use the first direction Ensemblis has ranked.</strong>
          <p>Today still owns the release priority. Create is now only about choosing among a small number of musically grounded ideas.</p>
        </div>
        <Link className="button" href={href("/studio")}>Open Today</Link>
      </aside>

      <details className="v2-advanced-disclosure create-specialist-tools">
        <summary>Other starting points</summary>
        <div className="create-specialist-links">
          {otherStartingPoints.map((item) => (
            <Link href={item.href} key={item.title}>{item.title}<span>{item.description}</span></Link>
          ))}
        </div>
      </details>

      <details className="v2-advanced-disclosure create-specialist-tools">
        <summary>Specialist and legacy tools</summary>
        <div className="create-specialist-links">
          <Link href={href("/studio/campaigns")}>Campaign Brain <span>Experiment inspection, strategy overrides and campaign debugging</span></Link>
          <Link href={href("/studio/outreach")}>Outreach <span>Direct relationship and outreach workflows</span></Link>
          <Link href={href("/studio/content")}>Legacy Content Lab <span>Older content controls kept for exceptional cases</span></Link>
        </div>
      </details>
    </div>
  );
}
