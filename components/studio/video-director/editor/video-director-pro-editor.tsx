"use client";

/* eslint-disable @next/next/no-img-element */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  assignVideoSourceAsset,
  createVideoCharacter,
  updateVideoEditorState,
  updateVideoShotEditor,
  updateVideoShotTiming,
} from "@/app/studio/video-editor-actions";
import { trimVideoShotStart } from "@/app/studio/video-editor-timing-actions";
import {
  buildCmx3600Edl,
  buildFcpxml,
  formatEditorTime,
  parseEditorMusicMap,
  shotReadiness,
  smartSnapTime,
} from "@/lib/video-director/editor";
import type { MediaAsset } from "@/types/database";
import type { ExtendedMusicVideoShot } from "@/types/video-database";
import type { VideoWorkspaceData } from "../workspace-types";
import { ProgramMonitor } from "./program-monitor";
import { ShotVariantLab } from "./shot-variant-lab";
import { SourceAssemblyControls } from "./source-assembly-controls";
import { StemActivityLane } from "./stem-activity-lane";
import { useVideoEditorPlayback } from "./use-video-editor-playback";

type PaletteTab = "story" | "media" | "cast" | "lyrics" | "music";
type SnapMode = "off" | "beats" | "smart";
type DragKind = "move" | "start" | "end";
type DraftTiming = { startMs: number; endMs: number };
type DragState = DraftTiming & { shotId: string; kind: DragKind; originX: number };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isVideoAsset(asset: MediaAsset | undefined) {
  if (!asset) return false;
  const url = asset.public_url?.toLowerCase() ?? "";
  return asset.mime_type?.startsWith("video/") === true || /\.(mp4|mov|webm|m4v)(\?|$)/.test(url) || /video|footage|clip/.test(asset.asset_type.toLowerCase());
}

function downloadText(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function editableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input,textarea,select,[contenteditable='true']"));
}

function sourceSuggestion(shot: ExtendedMusicVideoShot) {
  const suggestion = record(record(shot.editor_config).source_suggestion);
  return typeof suggestion.assetId === "string" ? suggestion : null;
}

function Palette({
  data,
  tab,
  selectedShot,
  onSelectShot,
}: {
  data: VideoWorkspaceData;
  tab: PaletteTab;
  selectedShot: ExtendedMusicVideoShot | null;
  onSelectShot: (id: string) => void;
}) {
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [characterName, setCharacterName] = useState("");

  if (tab === "story") {
    return (
      <div className="video-editor-palette-content">
        <div className="video-editor-panel-heading"><span>Story</span><strong>{data.scenes.length} scenes</strong></div>
        <div className="video-editor-story-list">
          {data.scenes.map((scene) => {
            const sceneShots = data.shots.filter((shot) => shot.scene_id === scene.id);
            return (
              <section key={scene.id}>
                <div><strong>{scene.title}</strong><small>{formatEditorTime(scene.start_ms)} - {formatEditorTime(scene.end_ms)}</small></div>
                {sceneShots.map((shot) => (
                  <button key={shot.id} type="button" className={selectedShot?.id === shot.id ? "is-selected" : ""} onClick={() => onSelectShot(shot.id)}>
                    <span>{shot.display_order + 1}</span><p>{shot.description}</p>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  if (tab === "media") {
    return (
      <div className="video-editor-palette-content">
        <div className="video-editor-panel-heading"><span>Media library</span><strong>{data.assets.length} assets</strong></div>
        <SourceAssemblyControls data={data} selectedShot={selectedShot} />
        <div className="video-editor-subheading">Manual source</div>
        <p className="video-editor-panel-hint">Pick a specific real asset when you want to override the rough-cut suggestion. Manual assignment is always explicit.</p>
        <div className="video-editor-media-grid">
          {data.assets.map((asset) => (
            <button key={asset.id} type="button" className={selectedMediaId === asset.id ? "is-selected" : ""} onClick={() => setSelectedMediaId(asset.id)}>
              {asset.public_url && !isVideoAsset(asset) ? <img src={asset.public_url} alt="" /> : <span>{String(asset.asset_type).replaceAll("_", " ")}</span>}
              <small>{String(asset.asset_type).replaceAll("_", " ")}</small>
            </button>
          ))}
        </div>
        <button
          className="button primary video-editor-palette-action"
          type="button"
          disabled={!selectedShot || !selectedMediaId || pending}
          onClick={() => selectedShot && selectedMediaId && startTransition(() => assignVideoSourceAsset({ projectId: data.project.id, shotId: selectedShot.id, assetId: selectedMediaId, sourceOffsetMs: 0 }))}
        >{pending ? "Assigning..." : "Use as shot source"}</button>
      </div>
    );
  }

  if (tab === "cast") {
    return (
      <div className="video-editor-palette-content">
        <div className="video-editor-panel-heading"><span>Cast and identity</span><strong>{data.characters.length} saved</strong></div>
        <p className="video-editor-panel-hint">Artist Cast keeps approved identity references and continuity rules reusable across projects.</p>
        <div className="video-editor-cast-list">
          {data.characters.map((character) => (
            <article key={character.id}>
              <div className="video-editor-avatar">{character.name.slice(0, 2).toUpperCase()}</div>
              <div><strong>{character.name}</strong><small>{character.role} · {Math.round(character.style_lock_strength * 100)}% lock</small></div>
            </article>
          ))}
        </div>
        <div className="video-editor-inline-form">
          <input value={characterName} onChange={(event) => setCharacterName(event.target.value)} placeholder="New character name" aria-label="New character name" />
          <button className="button" type="button" disabled={!characterName.trim() || pending} onClick={() => startTransition(async () => {
            await createVideoCharacter({ projectId: data.project.id, name: characterName, role: "character", identityPrompt: "", referenceAssetIds: selectedMediaId ? [selectedMediaId] : [] });
            setCharacterName("");
          })}>Add</button>
        </div>
      </div>
    );
  }

  if (tab === "lyrics") {
    return (
      <div className="video-editor-palette-content">
        <div className="video-editor-panel-heading"><span>Lyrics</span><strong>{data.lyricCues.length} timed lines</strong></div>
        <p className="video-editor-panel-hint">These are canonical Lyrics Intelligence cues on the same master clock as the timeline.</p>
        <div className="video-editor-lyrics-list">
          {data.lyricCues.length ? data.lyricCues.map((cue) => (
            <button key={cue.id} type="button" onClick={() => navigator.clipboard?.writeText(cue.text)}>
              <small>{formatEditorTime(cue.startMs)}</small><span>{cue.text}</span>
            </button>
          )) : <div className="video-editor-empty-note">No timed lyric lines are available for this track yet.</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="video-editor-palette-content">
      <div className="video-editor-panel-heading"><span>Music intelligence</span><strong>{data.stems.length} stems</strong></div>
      <div className="video-editor-stem-list">
        {data.stems.map((stem) => (
          <article key={stem.id}><span className={`stem-dot stem-${stem.category}`} /><div><strong>{stem.label}</strong><small>{stem.category} · {stem.status}</small></div></article>
        ))}
      </div>
      {data.audioScenes.length ? <>
        <div className="video-editor-subheading">Audio Scenes</div>
        <div className="video-editor-audio-scenes">
          {data.audioScenes.map((scene) => <article key={scene.id}><strong>{scene.name}</strong><small>{scene.startMs !== null ? `${formatEditorTime(scene.startMs)} - ${formatEditorTime(scene.endMs ?? scene.startMs)}` : scene.sceneType}</small></article>)}
        </div>
      </> : null}
      <p className="video-editor-panel-hint">Stem lanes use measured 500 ms activity from Stem Intelligence, not decorative waveforms.</p>
    </div>
  );
}

function ShotInspector({ data, shot }: { data: VideoWorkspaceData; shot: ExtendedMusicVideoShot | null }) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const performance = record(shot?.performance_config);
  const lyrics = record(shot?.lyrics_config);
  const reactivity = record(shot?.music_reactivity);
  const editor = record(shot?.editor_config);
  const [description, setDescription] = useState(shot?.description ?? "");
  const [prompt, setPrompt] = useState(shot?.prompt ?? "");
  const [shotType, setShotType] = useState<ExtendedMusicVideoShot["shot_type"]>(shot?.shot_type ?? "generated");
  const [characterId, setCharacterId] = useState(shot?.character_id ?? "");
  const [lipSync, setLipSync] = useState(performance.lip_sync === true);
  const [captionEnabled, setCaptionEnabled] = useState(lyrics.enabled === true);
  const [captionText, setCaptionText] = useState(typeof lyrics.text === "string" ? lyrics.text : "");
  const [captionStyle, setCaptionStyle] = useState<"clean" | "editorial" | "karaoke" | "poster">(
    ["clean", "editorial", "karaoke", "poster"].includes(String(lyrics.style)) ? String(lyrics.style) as "clean" | "editorial" | "karaoke" | "poster" : "clean",
  );
  const [cameraIntent, setCameraIntent] = useState(typeof editor.camera_intent === "string" ? editor.camera_intent : "");
  const [react, setReact] = useState<Record<string, number>>({
    vocals: numberValue(reactivity.vocals, 0.5),
    drums: numberValue(reactivity.drums, 0.5),
    bass: numberValue(reactivity.bass, 0.35),
    percussion: numberValue(reactivity.percussion, 0.25),
    energy: numberValue(reactivity.energy, 0.6),
  });

  if (!shot) return <aside className="video-editor-inspector"><div className="video-editor-inspector-empty"><strong>No shot selected</strong><p>Select a timeline clip to edit it. The Program Monitor can continue following playback independently.</p></div></aside>;

  const shotId = shot.id;
  const readiness = shotReadiness(shot, data.characters, data.contextSignals.hasAudio);
  const timedLyrics = data.lyricCues.filter((cue) => cue.endMs > shot.start_ms && cue.startMs < shot.end_ms);

  function save() {
    startTransition(async () => {
      await updateVideoShotEditor({
        projectId: data.project.id,
        shotId,
        description,
        prompt: prompt || null,
        shotType,
        characterId: characterId || null,
        lipSync,
        captionEnabled,
        captionText,
        captionStyle,
        cameraIntent,
        reactivity: react,
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
    });
  }

  return (
    <aside className="video-editor-inspector">
      <div className="video-editor-inspector-head"><div><span>Shot {shot.display_order + 1}</span><strong>{formatEditorTime(shot.start_ms)} - {formatEditorTime(shot.end_ms)}</strong></div><div className={`video-editor-readiness ${readiness.ready ? "is-ready" : ""}`} title={readiness.issues.join(", ") || "Ready"}>{readiness.score}</div></div>
      <label className="video-editor-field"><span>Shot type</span><select value={shotType} onChange={(event) => setShotType(event.target.value as typeof shotType)}><option value="generated">Generated</option><option value="performance">Performance</option><option value="source_media">Source footage</option><option value="graphic">Graphic / type</option><option value="hold">Hold / freeze</option></select></label>
      <label className="video-editor-field"><span>Editorial intent</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label>
      {(shotType === "generated" || shotType === "performance") ? <label className="video-editor-field"><span>Generation prompt</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} placeholder="Describe subject, action, camera and visual intent" /></label> : null}

      <div className="video-editor-inspector-section">
        <div className="video-editor-subheading">Cast and performance</div>
        <label className="video-editor-field"><span>Character lock</span><select value={characterId} onChange={(event) => setCharacterId(event.target.value)}><option value="">No locked identity</option>{data.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
        {shotType === "performance" ? <label className="video-editor-toggle"><input type="checkbox" checked={lipSync} onChange={(event) => setLipSync(event.target.checked)} /><span><strong>Sync performance to vocal</strong><small>Routes through audio-reference-capable continuity generation. Final lip-sync still requires exact human attestation.</small></span></label> : null}
        <label className="video-editor-field"><span>Camera intent</span><input value={cameraIntent} onChange={(event) => setCameraIntent(event.target.value)} placeholder="e.g. slow dolly-in, locked profile close-up" /></label>
      </div>

      <div className="video-editor-inspector-section">
        <div className="video-editor-subheading">Music response</div>
        {Object.entries(react).map(([key, value]) => <label className="video-editor-slider" key={key}><span>{key}</span><input type="range" min="0" max="1" step="0.05" value={value} onChange={(event) => setReact((current) => ({ ...current, [key]: Number(event.target.value) }))} /><strong>{Math.round(value * 100)}%</strong></label>)}
      </div>

      <div className="video-editor-inspector-section">
        <div className="video-editor-subheading">Lyrics and captions</div>
        <label className="video-editor-toggle"><input type="checkbox" checked={captionEnabled} onChange={(event) => setCaptionEnabled(event.target.checked)} /><span><strong>Show caption</strong><small>{timedLyrics.length ? `${timedLyrics.length} canonical timed line${timedLyrics.length === 1 ? "" : "s"} overlap this shot.` : "No timed lyric line overlaps this shot."}</small></span></label>
        {captionEnabled ? <>{timedLyrics.length ? <div className="video-editor-lyric-suggestions">{timedLyrics.map((cue) => <button type="button" key={cue.id} onClick={() => setCaptionText(cue.text)}>{cue.text}</button>)}</div> : null}<textarea className="video-editor-caption-input" value={captionText} onChange={(event) => setCaptionText(event.target.value)} rows={2} placeholder="Caption text" /><select value={captionStyle} onChange={(event) => setCaptionStyle(event.target.value as typeof captionStyle)}><option value="clean">Clean</option><option value="editorial">Editorial</option><option value="karaoke">Karaoke</option><option value="poster">Poster</option></select></> : null}
      </div>

      <div className="video-editor-inspector-section video-editor-generation-summary">
        <div className="video-editor-subheading">Generation routing</div>
        <dl><div><dt>Model</dt><dd>{shot.selected_model ?? "Auto"}</dd></div><div><dt>Priority</dt><dd>{shotType === "performance" ? "Consistency" : shot.generation_priority}</dd></div><div><dt>Prompt version</dt><dd>v{shot.prompt_version}</dd></div></dl>
        {readiness.issues.length ? <ul>{readiness.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p className="video-editor-ready-note">Shot is production-ready.</p>}
      </div>
      <ShotVariantLab data={data} shot={shot} />
      <button className="button primary video-editor-save" type="button" onClick={save} disabled={pending || !description.trim()}>{pending ? "Saving..." : saved ? "Saved" : "Save shot"}</button>
    </aside>
  );
}

export function VideoDirectorProEditor({ data }: { data: VideoWorkspaceData }) {
  const editorState = record(data.project.editor_state);
  const fallbackDuration = Math.max(numberValue(data.track.duration, 0) * 1000, ...data.shots.map((shot) => shot.end_ms), 1);
  const musicMap = useMemo(() => parseEditorMusicMap(data.project.music_map, fallbackDuration), [data.project.music_map, fallbackDuration]);
  const [paletteTab, setPaletteTab] = useState<PaletteTab>("story");
  const [selectedShotId, setSelectedShotId] = useState(data.shots[0]?.id ?? null);
  const [zoom, setZoom] = useState(Math.max(0.7, Math.min(4, numberValue(editorState.zoom, 1))));
  const [snapMode, setSnapMode] = useState<SnapMode>(["off", "beats", "smart"].includes(String(editorState.snap_mode)) ? String(editorState.snap_mode) as SnapMode : "smart");
  const [loopSelected, setLoopSelected] = useState(false);
  const [draftTimings, setDraftTimings] = useState<Record<string, DraftTiming>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const [, startTransition] = useTransition();
  const timelineContentRef = useRef<HTMLDivElement | null>(null);
  const selectedShot = data.shots.find((shot) => shot.id === selectedShotId) ?? null;
  const loopRange = loopSelected && selectedShot ? { startMs: selectedShot.start_ms, endMs: selectedShot.end_ms } : null;
  const { audioRef, playheadMs, isPlaying, seek, togglePlayback, audioProps } = useVideoEditorPlayback({ durationMs: musicMap.durationMs, loopRange });
  const activeShot = useMemo(() => {
    const exact = data.shots.find((shot) => playheadMs >= shot.start_ms && playheadMs < shot.end_ms);
    if (exact) return exact;
    if (playheadMs >= musicMap.durationMs - 5) return [...data.shots].sort((a, b) => b.end_ms - a.end_ms)[0] ?? null;
    return null;
  }, [data.shots, musicMap.durationMs, playheadMs]);
  const hardBudget = Number(data.project.hard_budget_credits || 0);
  const committed = Number(data.project.spent_credits || 0) + Number(data.project.reserved_credits || 0);
  const budgetPercent = hardBudget > 0 ? Math.min(100, (committed / hardBudget) * 100) : 0;
  const inspectorKey = selectedShot
    ? [selectedShot.id, selectedShot.prompt_version, selectedShot.shot_type, selectedShot.selected_asset_id ?? "", selectedShot.character_id ?? ""].join(":")
    : "none";

  function selectShot(id: string, cue = true) {
    setSelectedShotId(id);
    if (cue) {
      const shot = data.shots.find((item) => item.id === id);
      if (shot) seek(shot.start_ms);
    }
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (editableTarget(event.target)) return;
      if (event.code === "Space") { event.preventDefault(); togglePlayback(); return; }
      if ((event.metaKey || event.ctrlKey) && (event.key === "+" || event.key === "=")) { event.preventDefault(); setZoom((value) => Math.min(4, value + 0.25)); return; }
      if ((event.metaKey || event.ctrlKey) && event.key === "-") { event.preventDefault(); setZoom((value) => Math.max(0.7, value - 0.25)); return; }
      if (event.key.toLowerCase() === "l" && selectedShot) { event.preventDefault(); setLoopSelected((value) => !value); return; }
      if (event.key === "ArrowLeft" && !event.metaKey && !event.ctrlKey) seek(playheadMs - (event.shiftKey ? 5000 : 1000));
      if (event.key === "ArrowRight" && !event.metaKey && !event.ctrlKey) seek(playheadMs + (event.shiftKey ? 5000 : 1000));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [playheadMs, seek, selectedShot, togglePlayback]);

  function timingFor(shot: ExtendedMusicVideoShot) {
    return draftTimings[shot.id] ?? { startMs: shot.start_ms, endMs: shot.end_ms };
  }

  function beginDrag(event: ReactPointerEvent, shot: ExtendedMusicVideoShot, kind: DragKind) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const timing = timingFor(shot);
    setDrag({ shotId: shot.id, kind, originX: event.clientX, ...timing });
    selectShot(shot.id, false);
  }

  function moveDrag(event: ReactPointerEvent) {
    if (!drag || !timelineContentRef.current) return;
    const rect = timelineContentRef.current.getBoundingClientRect();
    if (!rect.width) return;
    const deltaMs = ((event.clientX - drag.originX) / rect.width) * musicMap.durationMs;
    const duration = drag.endMs - drag.startMs;
    let startMs = drag.startMs;
    let endMs = drag.endMs;
    if (drag.kind === "move") {
      startMs = Math.max(0, Math.min(musicMap.durationMs - duration, drag.startMs + deltaMs));
      endMs = startMs + duration;
    } else if (drag.kind === "start") {
      startMs = Math.max(0, Math.min(drag.endMs - 250, drag.startMs + deltaMs));
    } else {
      endMs = Math.min(musicMap.durationMs, Math.max(drag.startMs + 250, drag.endMs + deltaMs));
    }
    setDraftTimings((current) => ({ ...current, [drag.shotId]: { startMs, endMs } }));
  }

  function endDrag(event: ReactPointerEvent) {
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const raw = draftTimings[drag.shotId] ?? { startMs: drag.startMs, endMs: drag.endMs };
    let startMs = smartSnapTime(raw.startMs, musicMap, snapMode);
    let endMs = smartSnapTime(raw.endMs, musicMap, snapMode);
    if (endMs <= startMs + 200) endMs = Math.min(musicMap.durationMs, startMs + 250);
    if (drag.kind === "move") {
      const duration = drag.endMs - drag.startMs;
      endMs = Math.min(musicMap.durationMs, startMs + duration);
      startMs = Math.max(0, endMs - duration);
    }
    const shotId = drag.shotId;
    const dragKind = drag.kind;
    const previousStartMs = drag.startMs;
    setDraftTimings((current) => ({ ...current, [shotId]: { startMs, endMs } }));
    setDrag(null);
    if (dragKind === "start") {
      startTransition(() => trimVideoShotStart({ projectId: data.project.id, shotId, previousStartMs, startMs, endMs }));
    } else {
      startTransition(() => updateVideoShotTiming({ projectId: data.project.id, shotId, startMs, endMs }));
    }
  }

  function timelineSeek(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag || !timelineContentRef.current) return;
    const rect = timelineContentRef.current.getBoundingClientRect();
    seek(((event.clientX - rect.left) / rect.width) * musicMap.durationMs);
  }

  function persistEditorPreferences(next: { zoom?: number; snap_mode?: SnapMode }) {
    startTransition(() => updateVideoEditorState({ projectId: data.project.id, patch: next }));
  }

  const exportBase = data.project.title.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "ensemblis-video";

  return (
    <section className="video-editor-shell" aria-label="Ensemblis Video Director Pro editor">
      <header className="video-editor-toolbar">
        <div className="video-editor-transport">
          <button type="button" className="video-editor-icon-button" onClick={() => seek(0)} aria-label="Go to beginning">|‹</button>
          <button type="button" className="video-editor-play" onClick={togglePlayback} disabled={!data.audioUrl}>{isPlaying ? "Pause" : "Play"}</button>
          <button type="button" className={`video-editor-icon-button video-editor-loop ${loopSelected ? "is-active" : ""}`} aria-pressed={loopSelected} disabled={!selectedShot} onClick={() => setLoopSelected((value) => !value)} title="Loop selected shot (L)">↻</button>
          <span className="video-editor-time">{formatEditorTime(playheadMs)}</span>
          <span className="video-editor-bpm">{musicMap.bpm ? `${Math.round(musicMap.bpm)} BPM` : "Music map"}</span>
        </div>
        <div className="video-editor-toolbar-center">
          <label>Snap<select value={snapMode} onChange={(event) => { const mode = event.target.value as SnapMode; setSnapMode(mode); persistEditorPreferences({ snap_mode: mode }); }}><option value="smart">Smart</option><option value="beats">Beats</option><option value="off">Off</option></select></label>
          <label className="video-editor-zoom">Zoom<input type="range" min="0.7" max="4" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} onPointerUp={() => persistEditorPreferences({ zoom })} /></label>
        </div>
        <div className="video-editor-toolbar-actions">
          <div className="video-editor-budget" title={`${committed.toFixed(1)} of ${hardBudget.toFixed(1)} credits committed`}><span><i style={{ width: `${budgetPercent}%` }} /></span><small>{hardBudget ? `${(hardBudget - committed).toFixed(1)} cr left` : "No spend cap set"}</small></div>
          <details className="video-editor-export"><summary>Export</summary><div><button type="button" onClick={() => downloadText(`${exportBase}.edl`, buildCmx3600Edl(data.project.title, data.shots), "text/plain")}>CMX 3600 EDL</button><button type="button" onClick={() => downloadText(`${exportBase}.fcpxml`, buildFcpxml(data.project.title, data.shots), "application/xml")}>FCPXML / Resolve</button></div></details>
        </div>
      </header>

      {data.audioUrl ? <audio ref={audioRef} src={data.audioUrl} preload="metadata" {...audioProps} /> : null}

      <div className="video-editor-workbench">
        <nav className="video-editor-palette-tabs" aria-label="Editor tools">{(["story", "media", "cast", "lyrics", "music"] as PaletteTab[]).map((tab) => <button type="button" key={tab} className={paletteTab === tab ? "is-active" : ""} onClick={() => setPaletteTab(tab)}>{tab}</button>)}</nav>
        <aside className="video-editor-palette"><Palette data={data} tab={paletteTab} selectedShot={selectedShot} onSelectShot={(id) => selectShot(id)} /></aside>
        <main className="video-editor-canvas">
          <div className="video-editor-canvas-head"><div><span>Program</span><strong>{activeShot ? `Shot ${activeShot.display_order + 1}` : data.project.title}</strong></div><div>{selectedShot && activeShot?.id !== selectedShot.id ? <span className="video-editor-selection-note">Inspector: Shot {selectedShot.display_order + 1}</span> : null}<span>{data.project.primary_aspect_ratio}</span><span>{data.project.target_resolution}</span></div></div>
          <ProgramMonitor data={data} shot={activeShot} playheadMs={playheadMs} isPlaying={isPlaying} />
          <div className="video-editor-canvas-note"><span>Space</span> play/pause <span>← →</span> seek <span>Shift + ← →</span> 5 sec <span>L</span> loop selected <span>⌘ +/-</span> zoom</div>
        </main>
        <ShotInspector key={inspectorKey} data={data} shot={selectedShot} />
      </div>

      <div className="video-editor-timeline-shell">
        <div className="video-editor-timeline-labels" aria-hidden="true"><span>Structure</span><span>Lyrics</span>{data.stems.slice(0, 4).map((stem) => <span key={stem.id}>{stem.category}</span>)}<strong>Video</strong></div>
        <div className="video-editor-timeline-scroll">
          <div ref={timelineContentRef} className="video-editor-timeline-content" style={{ width: `${Math.max(100, zoom * 100)}%` }} onPointerDown={timelineSeek}>
            <div className="video-editor-ruler">{Array.from({ length: Math.max(2, Math.ceil(musicMap.durationMs / 10000) + 1) }, (_, index) => index * 10000).filter((ms) => ms <= musicMap.durationMs).map((ms) => <span key={ms} style={{ left: `${(ms / musicMap.durationMs) * 100}%` }}>{formatEditorTime(ms).slice(0, 5)}</span>)}</div>
            <div className="video-editor-structure-lane">{musicMap.sections.map((section) => <div key={section.id} className={playheadMs >= section.startMs && playheadMs < section.endMs ? "is-active" : ""} style={{ left: `${(section.startMs / musicMap.durationMs) * 100}%`, width: `${((section.endMs - section.startMs) / musicMap.durationMs) * 100}%` }}><span>{section.label}</span></div>)}</div>
            <div className="video-editor-lyrics-lane">{data.lyricCues.map((cue) => <div key={cue.id} className={playheadMs >= cue.startMs && playheadMs < cue.endMs ? "is-active" : ""} title={cue.text} style={{ left: `${(cue.startMs / musicMap.durationMs) * 100}%`, width: `${Math.max(0.25, ((cue.endMs - cue.startMs) / musicMap.durationMs) * 100)}%` }} />)}</div>
            {data.stems.slice(0, 4).map((stem) => <StemActivityLane key={stem.id} analysis={stem.analysis} durationMs={musicMap.durationMs} />)}
            <div className="video-editor-video-lane">
              {data.shots.map((shot) => {
                const timing = timingFor(shot);
                const readiness = shotReadiness(shot, data.characters, data.contextSignals.hasAudio);
                const suggested = sourceSuggestion(shot);
                return <div
                  key={shot.id}
                  className={`video-editor-clip clip-${shot.shot_type} ${selectedShotId === shot.id ? "is-selected" : ""} ${activeShot?.id === shot.id ? "is-active-playback" : ""} ${readiness.ready ? "is-ready" : "has-issues"}`}
                  style={{ left: `${(timing.startMs / musicMap.durationMs) * 100}%`, width: `${Math.max(0.35, ((timing.endMs - timing.startMs) / musicMap.durationMs) * 100)}%` }}
                  onPointerDown={(event) => beginDrag(event, shot, "move")}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onDoubleClick={() => selectShot(shot.id)}
                  title={`${formatEditorTime(timing.startMs)} - ${formatEditorTime(timing.endMs)} · ${shot.description}`}
                >
                  <button type="button" className="video-editor-trim-handle trim-start" aria-label="Trim shot start" onPointerDown={(event) => beginDrag(event, shot, "start")} />
                  <span><small>{shot.display_order + 1}</small><strong>{shot.description}</strong></span>
                  {suggested && !shot.selected_asset_id ? <i className="video-editor-source-badge">SRC?</i> : null}
                  {shot.character_id ? <i className="video-editor-character-badge">ID</i> : null}
                  {record(shot.performance_config).lip_sync === true ? <i className="video-editor-sync-badge">SYNC</i> : null}
                  <button type="button" className="video-editor-trim-handle trim-end" aria-label="Trim shot end" onPointerDown={(event) => beginDrag(event, shot, "end")} />
                </div>;
              })}
            </div>
            {musicMap.beats.map((beat, index) => <i key={`beat-${index}`} className="video-editor-beat" style={{ left: `${(beat / musicMap.durationMs) * 100}%` }} />)}
            {musicMap.downbeats.map((beat, index) => <i key={`downbeat-${index}`} className="video-editor-downbeat" style={{ left: `${(beat / musicMap.durationMs) * 100}%` }} />)}
            <div className="video-editor-playhead" style={{ left: `${(playheadMs / musicMap.durationMs) * 100}%` }}><i /></div>
          </div>
        </div>
      </div>
    </section>
  );
}
