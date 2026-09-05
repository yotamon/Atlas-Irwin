import Link from "next/link";
import { notFound } from "next/navigation";
import { analyzeMusicTrack } from "@/app/studio/growth-media-actions-safe";
import { LyricsIntelligencePanel } from "@/components/studio/lyrics-intelligence-panel";
import { MusicIntelligencePreview } from "@/components/studio/music-intelligence-preview";
import { ObjectHeader } from "@/components/studio/object-header";
import { StemIntelligencePanel } from "@/components/studio/stem-intelligence-panel";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import type { Track } from "@/types/database";

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function duration(seconds: number | null) {
  if (!seconds) return "Duration pending";
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function hasMusicMap(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function analysisStatus(value: unknown) {
  const status = asRecord(value).status;
  return typeof status === "string" ? status : "pending";
}

export default async function TrackWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);
  const growth = asGrowthClient(supabase);
  const music = asArtistScopedMusicClient(supabase);

  const { data: vaultTrack, error: vaultError } = await growth
    .from("track_vault")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (vaultError) throw new Error(vaultError.message);
  if (!vaultTrack) notFound();

  let release: { id: string; title: string; artwork_url: string | null; cover_alt: string | null; release_date: string | null } | null = null;
  let releaseTrack: Track | null = null;
  if (vaultTrack.linked_release_id) {
    const [releaseResult, tracksResult] = await Promise.all([
      music
        .from("releases")
        .select("id,title,artwork_url,cover_alt,release_date")
        .eq("id", vaultTrack.linked_release_id)
        .eq("artist_id", artist.artistId)
        .maybeSingle(),
      music
        .from("tracks")
        .select("*")
        .eq("release_id", vaultTrack.linked_release_id)
        .eq("artist_id", artist.artistId)
        .order("is_primary", { ascending: false })
        .order("display_order", { ascending: true }),
    ]);
    if (releaseResult.error) throw new Error(releaseResult.error.message);
    if (tracksResult.error) throw new Error(tracksResult.error.message);
    release = releaseResult.data;
    releaseTrack = (tracksResult.data ?? []).find((track) => track.is_primary) ?? tracksResult.data?.[0] ?? null;
  }

  const intelligenceReady = hasMusicMap(vaultTrack.audio_profile);
  const musicMap = asRecord(vaultTrack.audio_profile);
  const sections = Array.isArray(musicMap.sections) ? musicMap.sections.length : 0;
  const hooks = Array.isArray(musicMap.hook_candidates) ? musicMap.hook_candidates.length : 0;
  const bpm = typeof musicMap.bpm === "number" && Number.isFinite(musicMap.bpm) ? Math.round(musicMap.bpm) : null;
  const currentAnalysisStatus = analysisStatus(vaultTrack.analysis);
  const analysisNeedsRecovery = Boolean(
    vaultTrack.audio_url
    && !intelligenceReady
    && (currentAnalysisStatus === "failed" || currentAnalysisStatus === "unavailable"),
  );
  const createHref = href(`/studio/create?intent=asset&track=${vaultTrack.id}`);
  const tabs = [
    { label: "Overview", href: "#overview", active: true },
    { label: "Intelligence", href: "#intelligence" },
    ...(releaseTrack ? [{ label: "Stems", href: "#stems" }, { label: "Lyrics", href: "#lyrics" }] : []),
  ];

  return (
    <div className="studio-v2-page track-object-page">
      <ObjectHeader
        backHref={href("/studio/music")}
        backLabel="Music"
        eyebrow="Track"
        title={vaultTrack.title}
        subtitle={`${titleCase(vaultTrack.status)} · ${duration(vaultTrack.duration_seconds)} · ${intelligenceReady ? "Understanding ready" : vaultTrack.audio_url ? currentAnalysisStatus === "queued" || currentAnalysisStatus === "running" ? "Ensemblis is listening" : "Master ready" : "Needs master"}`}
        imageUrl={release?.artwork_url}
        imageAlt={release?.cover_alt || (release ? `${release.title} artwork` : "")}
        facts={[
          { label: "Master", value: vaultTrack.audio_url ? "Ready" : "Missing" },
          { label: "Intelligence", value: intelligenceReady ? "Ready" : analysisNeedsRecovery ? "Needs attention" : "Listening" },
          { label: "Structure", value: intelligenceReady ? `${sections} section${sections === 1 ? "" : "s"}` : "Pending" },
          { label: "Strong moments", value: intelligenceReady ? `${Math.min(hooks, 5)} surfaced` : "Pending" },
          ...(bpm ? [{ label: "Tempo", value: `${bpm} BPM` }] : []),
        ]}
        actions={release
          ? <Link className="button primary" href={href(`/studio/releases/${release.id}`)}>Open release</Link>
          : intelligenceReady
            ? <Link className="button primary" href={createHref}>Create from this track</Link>
            : <Link className="button" href="#intelligence">Track Intelligence</Link>}
        tabs={tabs}
      />

      <section className="track-object-overview" id="overview">
        <div className="track-object-primary">
          <span className="section-label">Source audio</span>
          <h2>{vaultTrack.audio_url ? "Canonical master" : "Master audio is still missing"}</h2>
          {vaultTrack.notes ? <p>{vaultTrack.notes}</p> : <p>{vaultTrack.audio_url ? "This is the source Ensemblis uses to understand structure, energy and strongest moments." : "Ensemblis needs the actual mastered source before it can make music-aware creative recommendations."}</p>}
          {vaultTrack.audio_url ? <audio controls preload="metadata" src={vaultTrack.audio_url} /> : null}
        </div>
        <aside className="track-object-decision">
          <span className="section-label">Recommended next move</span>
          {intelligenceReady ? (
            <>
              <strong>Create from the strongest moment</strong>
              <p>Track Intelligence is ready. Start creative work from the musical evidence instead of choosing a random excerpt.</p>
              <Link href={createHref}>Create with this track →</Link>
            </>
          ) : analysisNeedsRecovery ? (
            <>
              <strong>Analysis needs attention</strong>
              <p>The master is safe. Retry only the intelligence step; there is no need to upload it again.</p>
              <Link href="#recovery">Open recovery →</Link>
            </>
          ) : vaultTrack.audio_url ? (
            <>
              <strong>No action needed</strong>
              <p>Ensemblis is preparing the musical understanding automatically. You can leave this screen.</p>
              <Link href={href("/studio/music")}>Back to Music →</Link>
            </>
          ) : (
            <>
              <strong>Add the real master</strong>
              <p>Music intelligence stays intentionally empty until Ensemblis has source audio to hear.</p>
              <Link href={href("/studio/music/import")}>Add mastered music →</Link>
            </>
          )}
        </aside>
      </section>

      <section className="track-object-section" id="intelligence">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Track Intelligence</span>
            <h2>{intelligenceReady ? "What Ensemblis hears in this track" : analysisNeedsRecovery ? "Understanding needs recovery" : "Ensemblis is understanding the track"}</h2>
          </div>
        </div>
        {intelligenceReady ? (
          <MusicIntelligencePreview audioUrl={vaultTrack.audio_url} musicMap={vaultTrack.audio_profile} />
        ) : (
          <div className="v2-calm-state compact">
            <strong>{analysisNeedsRecovery ? "The source master is safe." : vaultTrack.audio_url ? "Nothing to fill in manually." : "No source audio yet."}</strong>
            <p>{analysisNeedsRecovery ? "Use the recovery control below to retry Track Intelligence without changing the master." : vaultTrack.audio_url ? "Structure and strongest moments will appear here automatically when analysis completes." : "Add a master first. Ensemblis does not manufacture analysis without source audio."}</p>
          </div>
        )}

        <details className="track-object-advanced">
          <summary>Technical details</summary>
          <dl>
            <div><dt>Source</dt><dd>{titleCase(vaultTrack.source)}</dd></div>
            <div><dt>Analysis state</dt><dd>{titleCase(currentAnalysisStatus)}</dd></div>
            <div><dt>Music map</dt><dd>{intelligenceReady ? `v${typeof musicMap.version === "number" ? musicMap.version : "?"}` : "Pending"}</dd></div>
            <div><dt>Media asset</dt><dd>{vaultTrack.media_asset_id ? "Connected" : "Legacy source"}</dd></div>
          </dl>
        </details>

        {analysisNeedsRecovery ? (
          <details className="track-object-advanced" id="recovery">
            <summary>Analysis recovery</summary>
            <p className="v2-muted-copy">Retry only when Track Intelligence failed or the worker was unavailable. The existing master remains untouched.</p>
            <form action={analyzeMusicTrack}>
              <input type="hidden" name="id" value={vaultTrack.id} />
              <button className="button" type="submit">Retry Track Intelligence</button>
            </form>
          </details>
        ) : null}
      </section>

      {releaseTrack && release ? (
        <>
          <div className="track-object-section" id="stems">
            <StemIntelligencePanel releaseId={release.id} track={releaseTrack} />
          </div>
          <div className="track-object-section" id="lyrics">
            <LyricsIntelligencePanel releaseId={release.id} track={releaseTrack} />
          </div>
        </>
      ) : (
        <section className="track-object-section track-object-linked-context">
          <span className="section-label">Release context</span>
          <h2>Stems and lyrics attach when this track becomes a release.</h2>
          <p>Ensemblis keeps the unreleased master independent until you make the release decision. Once linked, release stems, lyrics and campaign moments appear in this same musical context.</p>
        </section>
      )}
    </div>
  );
}