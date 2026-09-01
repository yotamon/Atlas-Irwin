import type { SupabaseClient } from "@supabase/supabase-js";
import {
  analyzeTrackLyricsAction,
  markTrackInstrumentalAction,
  saveAndAnalyzeTrackLyricsAction,
  saveTrackLyricsAction,
} from "@/app/studio/lyrics-actions";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asLyricsAnalysis } from "@/lib/lyrics-intelligence/domain";
import type { Track } from "@/types/database";
import type {
  LyricsDatabase,
  TrackLyricMoment,
  TrackLyricSection,
  TrackLyrics,
  TrackLyricsAnalysis,
} from "@/types/lyrics-database";
import styles from "./lyrics-intelligence-panel.module.css";

function time(ms: number | null) {
  if (ms === null) return null;
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function range(start: number | null, end: number | null) {
  const from = time(start);
  const to = time(end);
  return from && to ? `${from}–${to}` : "Timing pending";
}

function hiddenContext(releaseId: string, trackId: string) {
  return <>
    <input type="hidden" name="release_id" value={releaseId} />
    <input type="hidden" name="track_id" value={trackId} />
  </>;
}

function LyricsForm({
  releaseId,
  trackId,
  lyrics,
  primary = false,
}: {
  releaseId: string;
  trackId: string;
  lyrics?: TrackLyrics | null;
  primary?: boolean;
}) {
  return <form className={styles.form} action={saveTrackLyricsAction}>
    {hiddenContext(releaseId, trackId)}
    <label className={styles.field}>
      <span>Official lyrics</span>
      <textarea
        className={styles.textarea}
        name="canonical_text"
        defaultValue={lyrics?.canonical_text ?? ""}
        placeholder={`[Verse 1]\nPaste the exact lyrics here…\n\n[Chorus]\nAtlas also understands section labels when you have them.`}
        required
      />
    </label>
    <label className={styles.field}>
      <span>Language</span>
      <input className={styles.input} name="language" defaultValue={lyrics?.language ?? ""} placeholder="Auto-detect, or enter e.g. English" />
    </label>
    <div className={styles.permissions}>
      <label className={styles.permission}>
        <input type="checkbox" name="allow_ai_context" defaultChecked={lyrics?.allow_ai_context ?? true} />
        <span>Use lyrics for creative intelligence<small>Lets Atlas understand meaning, narrative, imagery and hooks across campaigns and video.</small></span>
      </label>
      <label className={styles.permission}>
        <input type="checkbox" name="allow_media_quotes" defaultChecked={lyrics?.allow_media_quotes ?? true} />
        <span>Allow exact lyric excerpts in generated media<small>Atlas may quote only approved excerpts grounded in these official lyrics. It never invents lyric text.</small></span>
      </label>
    </div>
    <div className={styles.actions}>
      <button className="button primary" type="submit" formAction={saveAndAnalyzeTrackLyricsAction}>{primary ? "Save & analyze lyrics" : "Save changes & analyze"}</button>
      <button className="button" type="submit">Save only</button>
    </div>
  </form>;
}

export async function LyricsIntelligencePanel({
  releaseId,
  track,
}: {
  releaseId: string;
  track: Track | null;
}) {
  if (!track) {
    return <section className="v2-section v2-full-column" id="lyrics-intelligence">
      <div className="v2-section-heading"><div><span className="section-label">Lyrics Intelligence</span><h2>Add a track before adding lyrics</h2></div><span className="v2-count">Waiting</span></div>
      <p className="v2-muted-copy">Lyrics belong to a specific track, so Atlas will enable this as soon as the release has one.</p>
    </section>;
  }

  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as SupabaseClient<LyricsDatabase>;
  const { data: rawLyrics, error: lyricsError } = await db.from("track_lyrics")
    .select("*")
    .eq("track_id", track.id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (lyricsError) throw new Error(lyricsError.message);
  const lyrics = rawLyrics as TrackLyrics | null;

  if (!lyrics) {
    return <section className="v2-section v2-full-column" id="lyrics-intelligence">
      <div className="v2-section-heading">
        <div><span className="section-label">Lyrics Intelligence</span><h2>Give Atlas the words behind {track.title}</h2></div>
        <span className="v2-count has-items">Optional source</span>
      </div>
      <div className={`${styles.panel} ${styles.empty}`}>
        <p className={`v2-muted-copy ${styles.emptyIntro}`}>Paste the official lyrics once. Atlas will structure them, understand the song’s meaning and hooks, connect lyric moments to Track Intelligence, and reuse that context across campaign creative and Video Director.</p>
        <LyricsForm releaseId={releaseId} trackId={track.id} primary />
        <div className={styles.actions}>
          <span className="v2-muted-copy">No vocals on this track?</span>
          <form action={markTrackInstrumentalAction}>
            {hiddenContext(releaseId, track.id)}
            <button className="button" type="submit">Mark as instrumental</button>
          </form>
        </div>
      </div>
    </section>;
  }

  if (lyrics.status === "instrumental") {
    return <section className="v2-section v2-full-column" id="lyrics-intelligence">
      <div className="v2-section-heading">
        <div><span className="section-label">Lyrics Intelligence</span><h2>{track.title} is marked instrumental</h2></div>
        <span className="growth-active-label">No lyrics needed</span>
      </div>
      <div className="v2-calm-state compact"><strong>Atlas will not ask for lyrics on this track.</strong><p>Track Intelligence and Stem Intelligence remain available as the creative source of truth.</p></div>
      <details className={styles.editor}>
        <summary>Add lyrics instead</summary>
        <LyricsForm releaseId={releaseId} trackId={track.id} lyrics={{ ...lyrics, canonical_text: "", status: "verified" }} />
      </details>
    </section>;
  }

  const [sectionsResult, analysisResult, momentsResult] = await Promise.all([
    db.from("track_lyric_sections").select("*").eq("lyrics_id", lyrics.id).eq("lyrics_version", lyrics.version).order("display_order"),
    db.from("track_lyrics_analysis").select("*").eq("lyrics_id", lyrics.id).eq("lyrics_version", lyrics.version).maybeSingle(),
    db.from("track_lyric_moments").select("*").eq("lyrics_id", lyrics.id).eq("lyrics_version", lyrics.version).order("score", { ascending: false }).limit(6),
  ]);
  const firstError = sectionsResult.error || analysisResult.error || momentsResult.error;
  if (firstError) throw new Error(firstError.message);
  const sections = (sectionsResult.data ?? []) as TrackLyricSection[];
  const analysisRow = analysisResult.data as TrackLyricsAnalysis | null;
  const analysis = asLyricsAnalysis(analysisRow?.analysis);
  const moments = (momentsResult.data ?? []) as TrackLyricMoment[];
  const current = Boolean(analysis && analysisRow?.lyrics_version === lyrics.version);
  const aligned = sections.filter((section) => section.start_ms !== null && section.end_ms !== null).length;
  const primaryHook = sections.find((section) => section.is_primary_hook);

  return <section className="v2-section v2-full-column" id="lyrics-intelligence">
    <div className="v2-section-heading">
      <div><span className="section-label">Lyrics Intelligence</span><h2>{current ? "The words now inform the whole creative system" : "Official lyrics saved — intelligence needs a refresh"}</h2></div>
      <span className={current ? "growth-active-label" : "v2-count has-items"}>{current ? `v${lyrics.version} ready` : "Needs analysis"}</span>
    </div>

    <div className={styles.panel}>
      {current && analysis ? <div className={styles.hero}>
        <article className={styles.summary}>
          <div className={styles.chips}>{analysis.themes.slice(0, 7).map((theme) => <span className={styles.chip} key={theme}>{theme}</span>)}</div>
          <strong>{analysis.core_meaning}</strong>
          <p>{analysis.summary}</p>
        </article>
        <aside className={styles.statusCard}>
          <span className="section-label">Connected intelligence</span>
          <strong>{sections.length} sections · {moments.length} lyric moments</strong>
          <p>{aligned ? `${aligned}/${sections.length} sections aligned to the current Track Intelligence map.` : "Semantic intelligence is ready. Timing will attach automatically when matching Track Intelligence sections are available."}</p>
          {primaryHook ? <span className={styles.chip}>Primary hook · {primaryHook.label}</span> : null}
        </aside>
      </div> : <div className={styles.notice}>The exact lyrics are safe and current, but the semantic analysis is missing or stale. Re-analyze before Atlas uses derived themes, hooks or Lyric Moments.</div>}

      {current && analysis ? <div className={styles.workspace}>
        <div className={styles.column}>
          <div className={styles.columnHeader}><h3>Song structure</h3><span>lyrics ↔ music map</span></div>
          <div className={styles.sections}>{sections.map((section) => <article className={styles.sectionCard} key={section.id}>
            <div className={styles.sectionTop}><strong>{section.label}</strong><span className={styles.sectionMeta}>{range(section.start_ms, section.end_ms)}</span></div>
            <p>{section.is_primary_hook ? "Primary lyrical hook" : section.section_type.replaceAll("_", " ")}{section.music_section_id ? " · synced to music" : ""}</p>
          </article>)}</div>
        </div>
        <div className={styles.column}>
          <div className={styles.columnHeader}><h3>Best Lyric Moments</h3><span>ranked for creative use</span></div>
          <div className={styles.moments}>{moments.length ? moments.map((moment) => <article className={styles.moment} key={moment.id}>
            <div className={styles.momentTop}><strong>{moment.title}</strong><span className={styles.momentMeta}>{range(moment.start_ms, moment.end_ms)} · {Math.round(moment.score * 100)}%</span></div>
            {lyrics.allow_media_quotes && moment.allow_media ? <p className={styles.quote}>“{moment.excerpt}”</p> : <p className={styles.quote}>Lyric text protected from public quoting</p>}
            <p className={styles.momentReason}>{moment.interpretation}</p>
            <div className={styles.chips}>{moment.purpose_tags.slice(0, 4).map((tag) => <span className={styles.chip} key={tag}>{tag}</span>)}</div>
          </article>) : <div className="v2-calm-state compact"><strong>No high-confidence lyric moments yet.</strong><p>Atlas keeps weak suggestions out rather than filling the release with generic ideas.</p></div>}</div>
        </div>
      </div> : null}

      <div className={styles.actions}>
        {current ? <form action={analyzeTrackLyricsAction}>
          {hiddenContext(releaseId, track.id)}
          <button className="button" type="submit">Re-analyze intelligence</button>
        </form> : null}
      </div>

      <details className={styles.editor} open={!current}>
        <summary>{current ? "Edit official lyrics & usage" : "Review official lyrics"}</summary>
        <p>Editing the words or language creates a new canonical version. Atlas keeps revision history and will never silently rewrite your lyrics.</p>
        <LyricsForm releaseId={releaseId} trackId={track.id} lyrics={lyrics} />
      </details>
    </div>
  </section>;
}