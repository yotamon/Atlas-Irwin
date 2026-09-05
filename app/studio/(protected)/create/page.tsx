import Link from "next/link";
import { PageHeader } from "@/components/studio/ui";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { requireArtistContext } from "@/lib/studio/artist-context";
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
  if (value.includes("lyric") || value.includes("vocal")) return "Best starting point for a lyric-led Reel, Story or vocal hook.";
  if (value.includes("drop") || value.includes("climax") || value.includes("payoff")) return "Strong fit for a short teaser, release-day payoff or motion edit.";
  if (value.includes("groove") || value.includes("instrument")) return "Strong fit for a loop, movement-led short or production-focused creative.";
  if (value.includes("build") || value.includes("transition")) return "Strong fit for a narrative short, reveal or before/after structure.";
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

  const outcomes = [
    {
      index: "01",
      eyebrow: "Music",
      title: "Add or create music",
      description: "Bring in an existing master first, prepare a release, or create a new musical draft when that is actually the job.",
      href: href("/studio/music?view=add"),
      cta: "Add music",
    },
    {
      index: "02",
      eyebrow: "Release",
      title: "Start a release",
      description: "Create the release identity. Ensemblis classifies the lifecycle and builds only the work that is still actionable.",
      href: href("/studio/releases/new"),
      cta: "Create release",
    },
    {
      index: "03",
      eyebrow: "Campaign creative",
      title: "Open the production queue",
      description: "Create or refine only the campaign assets that already have a measurable job, using music and release context already in the system.",
      href: href("/studio/production"),
      cta: "Open production",
    },
    {
      index: "04",
      eyebrow: "Motion",
      title: "Direct a video",
      description: "Build a music-aware visual treatment with explicit quality and spend checkpoints inside one coherent creative world.",
      href: href(activeRelease ? `/studio/video?release=${activeRelease.id}` : "/studio/video"),
      cta: "Open Video Director",
    },
  ];

  return (
    <div className="studio-v2-page create-polish-page">
      <PageHeader
        title="Create"
        description={`Start from ${artist.artistName}'s actual music whenever Ensemblis already understands it. The musical Moment is the creative source; providers and prompts are implementation details.`}
      />

      {preferredMoments.length ? (
        <section className="v2-section">
          <div className="v2-section-heading">
            <div>
              <span className="section-label">Recommended musical starting points</span>
              <h2>Create from a Moment Ensemblis already understands</h2>
            </div>
            {activeRelease ? <Link href={href(`/studio/releases/${activeRelease.id}?stage=create#moments`)}>Review all Moments</Link> : null}
          </div>
          <p className="v2-muted-copy">
            These are approved Moments ranked from the track, lyric and stem evidence already stored for this artist. Choosing one keeps exact musical lineage attached to the creative and its later performance.
          </p>

          <div className="growth-opportunity-grid">
            {preferredMoments.map((moment) => {
              const release = releaseById.get(moment.release_id);
              const track = trackById.get(moment.track_id);
              const startSeconds = Math.max(0, moment.start_ms / 1000);
              const endSeconds = Math.max(startSeconds, moment.end_ms / 1000);
              const evidence = momentEvidenceSummary(moment);
              return (
                <article className="growth-opportunity accepted" key={moment.id}>
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
                  <div className="actions">
                    <Link className="button primary" href={href(`/studio/production?release=${moment.release_id}&moment=${moment.id}`)}>Create from this Moment</Link>
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

      <section className="create-intent-list" aria-label="Other creation outcomes">
        {outcomes.map((item) => (
          <Link className="create-intent-row" href={item.href} key={item.title}>
            <span className="create-intent-index">{item.index}</span>
            <span className="create-intent-copy">
              <small>{item.eyebrow}</small>
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </span>
            <b>{item.cta} →</b>
          </Link>
        ))}
      </section>

      <aside className="create-next-action-callout">
        <div>
          <span className="section-label">Not sure what should happen next?</span>
          <strong>Use the decision Ensemblis has already ranked.</strong>
          <p>Today separates what needs your judgment from work the system can keep doing on its own.</p>
        </div>
        <Link className="button" href={href("/studio")}>Open Today</Link>
      </aside>

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