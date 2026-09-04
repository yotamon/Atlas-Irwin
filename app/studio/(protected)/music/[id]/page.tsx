import Link from "next/link";
import { notFound } from "next/navigation";
import { LyricsIntelligencePanel } from "@/components/studio/lyrics-intelligence-panel";
import { MusicIntelligencePreview } from "@/components/studio/music-intelligence-preview";
import { ObjectHeader } from "@/components/studio/object-header";
import { StemIntelligencePanel } from "@/components/studio/stem-intelligence-panel";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { scoreVaultTrack } from "@/lib/studio/growth";
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

  const score = scoreVaultTrack(vaultTrack);
  const intelligenceReady = hasMusicMap(vaultTrack.audio_profile);
  const portfolioHref = `${href("/studio/growth?view=portfolio")}#vault`;
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
        subtitle={`${titleCase(vaultTrack.status)} · ${duration(vaultTrack.duration_seconds)} · ${intelligenceReady ? "Intelligence ready" : vaultTrack.audio_url ? "Master ready" : "Needs master"}`}
        imageUrl={release?.artwork_url}
        imageAlt={release?.cover_alt || (release ? `${release.title} artwork` : "")}
        facts={[
          { label: "Portfolio score", value: score.eligible ? Math.round(score.score) : "Hold" },
          { label: "Hook", value: `${Math.round(vaultTrack.hook_strength)}/100` },
          { label: "Short-form", value: `${Math.round(vaultTrack.short_form_potential)}/100` },
          { label: "Confidence", value: `${Math.round(vaultTrack.analysis_confidence * 100)}%` },
        ]}
        actions={release ? <Link className="button primary" href={href(`/studio/releases/${release.id}`)}>Open release</Link> : <Link className="button primary" href={portfolioHref}>Manage release decision</Link>}
        tabs={tabs}
      />

      <section className="track-object-overview" id="overview">
        <div className="track-object-primary">
          <span className="section-label">Source audio</span>
          <h2>{vaultTrack.audio_url ? "Canonical master" : "Master audio is still missing"}</h2>
          {vaultTrack.notes ? <p>{vaultTrack.notes}</p> : <p>{vaultTrack.audio_url ? "This is the source Ensemblis uses for structure, hook and creative-moment intelligence." : "Attach the mastered source in Portfolio before relying on track intelligence or release recommendations."}</p>}
          {vaultTrack.audio_url ? <audio controls preload="metadata" src={vaultTrack.audio_url} /> : null}
        </div>
        <aside className="track-object-decision">
          <span className="section-label">Decision context</span>
          <strong>{score.eligible ? `${Math.round(score.score)}/100` : "On hold"}</strong>
          <p>{score.blocker || score.reasons.join(" · ") || "Add stronger portfolio signals before making a release decision."}</p>
          <Link href={portfolioHref}>Edit portfolio signals →</Link>
        </aside>
      </section>

      <section className="track-object-section" id="intelligence">
        <div className="v2-section-heading"><div><span className="section-label">Track Intelligence</span><h2>{intelligenceReady ? "What Ensemblis hears in this track" : "Intelligence is not ready yet"}</h2></div></div>
        {intelligenceReady ? <MusicIntelligencePreview audioUrl={vaultTrack.audio_url} musicMap={vaultTrack.audio_profile} /> : <div className="v2-calm-state compact"><strong>{vaultTrack.audio_url ? "Master attached." : "No source audio yet."}</strong><p>{vaultTrack.audio_url ? "Use the Portfolio maintenance view to run or retry analysis. This workspace will become the readable interpretation layer once the map is ready." : "Attach a master first. Ensemblis does not manufacture analysis without source audio."}</p><Link className="button" href={portfolioHref}>Open Portfolio</Link></div>}
        <details className="track-object-advanced">
          <summary>Detailed track signals</summary>
          <dl>
            <div><dt>Artist rating</dt><dd>{vaultTrack.artist_rating ?? "Not rated"}</dd></div>
            <div><dt>Release readiness</dt><dd>{Math.round(vaultTrack.release_readiness)}/100</dd></div>
            <div><dt>Uniqueness</dt><dd>{Math.round(vaultTrack.uniqueness_score)}/100</dd></div>
            <div><dt>Visual potential</dt><dd>{Math.round(vaultTrack.visual_potential)}/100</dd></div>
            <div><dt>Hook window</dt><dd>{vaultTrack.hook_start_seconds !== null && vaultTrack.hook_end_seconds !== null ? `${vaultTrack.hook_start_seconds}s–${vaultTrack.hook_end_seconds}s` : "Intelligence decides"}</dd></div>
            <div><dt>Source</dt><dd>{titleCase(vaultTrack.source)}</dd></div>
          </dl>
        </details>
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
