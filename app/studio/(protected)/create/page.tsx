import Link from "next/link";
import { startOutcomeCreative } from "@/app/studio/create-actions";
import { PageHeader } from "@/components/studio/ui";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { requireArtistContext } from "@/lib/studio/artist-context";
import { CREATE_OUTCOMES } from "@/lib/studio/create-outcomes";
import { momentEvidenceSummary } from "@/lib/studio/evidence-labels";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asMomentsClient } from "@/lib/studio/moments-db";
import { createClient } from "@/lib/supabase/server";

function momentTime(ms: number) {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function momentRecommendation(label: string, sourceMode: string) {
  const value = `${label} ${sourceMode}`.toLowerCase();
  if (value.includes("lyric") || value.includes("vocal")) return "A strong source for lyric-led or vocal-forward creative.";
  if (value.includes("drop") || value.includes("climax") || value.includes("payoff")) return "A strong payoff window for discovery or release creative.";
  if (value.includes("groove") || value.includes("instrument")) return "A strong source for movement-led or production-focused creative.";
  if (value.includes("build") || value.includes("transition")) return "A strong source for reveal, progression or narrative creative.";
  return "An evidence-backed musical starting point for campaign creative.";
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
      .limit(6),
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
  const allMoments = momentsResult.data ?? [];
  const preferredMoments = activeRelease
    ? [
        ...allMoments.filter((moment) => moment.release_id === activeRelease.id),
        ...allMoments.filter((moment) => moment.release_id !== activeRelease.id),
      ].slice(0, 4)
    : allMoments.slice(0, 4);

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
      title: "Direct a full music video",
      description: "Use Video Director when the outcome is a larger coherent video rather than a campaign asset.",
      href: href(activeRelease ? `/studio/video?release=${activeRelease.id}` : "/studio/video"),
    },
  ];

  return (
    <div className="studio-v2-page create-polish-page">
      <PageHeader
        title="Create"
        description={`Choose what ${artist.artistName}'s music should achieve. Ensemblis keeps the musical Moment, delivery defaults, provider routing and lineage connected behind the outcome.`}
      />

      {preferredMoments.length ? (
        <section className="v2-section">
          <div className="v2-section-heading">
            <div>
              <span className="section-label">Start from the music</span>
              <h2>Choose a Moment, then choose the result you want</h2>
            </div>
            {activeRelease ? <Link href={href(`/studio/releases/${activeRelease.id}?stage=create#moments`)}>Review all Moments</Link> : null}
          </div>
          <p className="v2-muted-copy">
            These approved Moments are ranked from the track, lyric and stem evidence already stored for this artist. You choose the outcome; Ensemblis creates the production item with the musical lineage and delivery defaults already attached.
          </p>

          <div className="growth-opportunity-grid create-moment-grid">
            {preferredMoments.map((moment) => {
              const release = releaseById.get(moment.release_id);
              const track = trackById.get(moment.track_id);
              const startSeconds = Math.max(0, moment.start_ms / 1000);
              const endSeconds = Math.max(startSeconds, moment.end_ms / 1000);
              const evidence = momentEvidenceSummary(moment);
              return (
                <article className="growth-opportunity accepted create-moment-card" key={moment.id}>
                  <div className="growth-opportunity-head">
                    <span>{moment.source_mode.replaceAll("_", " ")}</span>
                    <strong>Recommended</strong>
                  </div>
                  <h3>{moment.label}</h3>
                  <p>{momentRecommendation(moment.label, moment.source_mode)}</p>
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

                  <div className="create-outcome-heading">
                    <strong>What should this Moment do?</strong>
                    <span>Choose the result, not the tool.</span>
                  </div>
                  <div className="create-outcome-grid" aria-label={`Creative outcomes for ${moment.label}`}>
                    {CREATE_OUTCOMES.map((outcome) => (
                      <form action={startOutcomeCreative} key={outcome.id}>
                        <input type="hidden" name="artist_id" value={artist.artistId} />
                        <input type="hidden" name="moment_id" value={moment.id} />
                        <input type="hidden" name="outcome" value={outcome.id} />
                        <button type="submit">
                          <strong>{outcome.label}</strong>
                          <span>{outcome.shortLabel}</span>
                        </button>
                      </form>
                    ))}
                  </div>
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
          <span className="section-label">Not sure which outcome matters?</span>
          <strong>Use the decision Ensemblis has already ranked.</strong>
          <p>Today separates what needs your judgment from work the system can keep doing on its own.</p>
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