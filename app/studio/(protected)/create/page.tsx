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

function momentTime(ms: number) { const total = Math.max(0, ms) / 1000; const minutes = Math.floor(total / 60); const seconds = Math.floor(total % 60); return `${minutes}:${String(seconds).padStart(2, "0")}`; }

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
  const activeRelease = (requestedReleaseId ? releases.find((release) => release.id === requestedReleaseId) : null) ?? releases.find((release) => release.active_release) ?? releases.find((release) => release.release_date && release.release_date >= new Date().toISOString().slice(0, 10)) ?? releases[0] ?? null;
  const curation = curateReleaseMoments({ moments: momentsResult.data ?? [] });
  const requestedMoments = params.track ? curation.curated.filter((moment) => moment.track_id === params.track) : curation.curated;
  const directionMoments = requestedMoments.length ? requestedMoments : curation.curated;
  const directions = recommendCreativeDirections({ moments: directionMoments, activeReleaseId: activeRelease?.id ?? null });
  const sourceHierarchy = creativeSourceHierarchy(operatingContext.profile);

  const otherStartingPoints = [
    { title: operatingContext.profile.aiPolicy.musicAllowed ? "Add or create music" : "Add music", description: operatingContext.profile.aiPolicy.musicAllowed ? "Bring in a master or create a musical draft when source music does not exist yet." : "Bring in the artist's existing master. AI music creation is disabled for this artist.", href: href("/studio/music?view=add") },
    { title: "Start a release", description: "Create the release identity before campaign creative exists.", href: href("/studio/releases/new") },
    { title: "Continue creative work", description: "Open the production queue only to continue creative work that is already in progress.", href: href("/studio/production") },
    { title: "Direct a video", description: operatingContext.profile.aiPolicy.visualsAllowed ? "Use Video Director for a larger coherent music video, still starting from artist identity and musical evidence." : "Use Video Director with source media, artwork and deterministic treatments; generative visuals are disabled for this artist.", href: href(activeRelease ? `/studio/video?release=${activeRelease.id}` : "/studio/video") },
  ];

  return (
    <div className="studio-v2-page create-polish-page">
      <PageHeader title="Create" description={requestedTrack ? `Creative directions from ${requestedTrack.title}.` : `Start from the strongest musical Moments for ${artist.artistName}.`} action={requestedTrack ? <Link className="button" href={href(`/studio/music/${requestedTrack.id}`)}>Back to track</Link> : undefined} />

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading compact"><div><span className="section-label">Artist creative policy</span><h2>Real artist material comes first</h2><p>{sourceHierarchy.slice(0, 6).join(" → ")}</p></div><Status>{operatingContext.profile.aiPolicy.visualsAllowed ? "Generative visuals allowed later" : "Source-first only"}</Status></div>
        <Link href={href("/studio/settings/artist")}>Review artist policy →</Link>
      </section>

      {directions.length ? <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Recommended musical starting points</span><h2>Choose the idea</h2></div>{activeRelease ? <Link href={href(`/studio/releases/${activeRelease.id}?stage=create#moments`)}>Review source Moments</Link> : null}</div><p className="v2-muted-copy">Choose from the three strongest creative directions. Each is an evidence-backed musical starting point from an approved Moment, and production inherits the artist creative policy.</p><div className="growth-opportunity-grid create-moment-grid">{directions.map((direction) => { const moment = direction.moment; const release = releaseById.get(moment.release_id); const track = trackById.get(moment.track_id); const startSeconds = Math.max(0, moment.start_ms / 1000); const endSeconds = Math.max(startSeconds, moment.end_ms / 1000); const evidence = momentEvidenceSummary(moment); return <article className="growth-opportunity accepted create-moment-card" key={direction.id}><div className="growth-opportunity-head"><span>Direction {direction.rank}</span>{direction.rank === 1 ? <strong>Recommended</strong> : <strong>{direction.outcome.label}</strong>}</div><h3>{direction.outcome.shortLabel}</h3><p>{direction.rationale}</p><small><strong>Source Moment:</strong> {moment.label}</small>{evidence ? <small>Why: {evidence}</small> : null}<small>{release?.title || "Release"} · {track?.title || "Track"} · {momentTime(moment.start_ms)}–{momentTime(moment.end_ms)}</small>{track?.audio_url ? <TrackPreview src={track.audio_url} startSeconds={startSeconds} endSeconds={endSeconds} label={moment.label} compact /> : null}<form action={startOutcomeCreative} className="create-direction-action"><input type="hidden" name="artist_id" value={artist.artistId} /><input type="hidden" name="moment_id" value={moment.id} /><input type="hidden" name="outcome" value={direction.outcome.id} /><button className="button primary" type="submit" title="Create from this Moment">Create this direction</button></form><div className="actions create-evidence-action"><Link className="button" href={href(`/studio/releases/${moment.release_id}?stage=create#moments`)}>Inspect evidence</Link></div></article>; })}</div></section> : <section className="v2-section"><div className="v2-calm-state compact"><strong>No approved musical Moment is ready yet.</strong><p>Add and analyze music first. Ensemblis will wait for real musical evidence.</p><Link className="button primary" href={href("/studio/music?view=add")}>Add music</Link></div></section>}

      <aside className="create-next-action-callout"><div><span className="section-label">Not sure what to make?</span><strong>Start with the first ranked direction.</strong><p>Today owns priority. Create only asks you to choose a musically grounded idea.</p></div><Link className="button" href={href("/studio")}>Open Today</Link></aside>
      <details className="v2-advanced-disclosure create-specialist-tools"><summary>Other starting points</summary><div className="create-specialist-links">{otherStartingPoints.map((item) => <Link href={item.href} key={item.title}>{item.title}<span>{item.description}</span></Link>)}</div></details>
    </div>
  );
}
