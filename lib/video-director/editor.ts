import type { ExtendedMusicVideoShot, MusicVideoCharacter } from "@/types/video-database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numbers(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

function timedItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const row = record(item);
    const ms = typeof row.ms === "number" ? row.ms : typeof row.start_ms === "number" ? row.start_ms : null;
    return ms === null ? [] : [{ id: String(row.id ?? index), ms, value: typeof row.value === "number" ? row.value : null }];
  });
}

export type EditorMusicSection = {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
  energy: number | null;
};

export type EditorMusicMap = {
  durationMs: number;
  bpm: number | null;
  beats: number[];
  downbeats: number[];
  editPoints: number[];
  energy: Array<{ ms: number; value: number | null }>;
  sections: EditorMusicSection[];
};

export function parseEditorMusicMap(value: unknown, fallbackDurationMs: number): EditorMusicMap {
  const map = record(value);
  const durationMs = typeof map.duration_ms === "number" && map.duration_ms > 0 ? map.duration_ms : Math.max(1, fallbackDurationMs);
  const beats = numbers(map.beats).length ? numbers(map.beats) : timedItems(map.beats).map((item) => item.ms);
  const downbeats = numbers(map.downbeats).length ? numbers(map.downbeats) : timedItems(map.downbeats).map((item) => item.ms);
  const editPoints = numbers(map.edit_points).length ? numbers(map.edit_points) : timedItems(map.edit_points).map((item) => item.ms);
  const sections = Array.isArray(map.sections) ? map.sections.flatMap((item, index) => {
    const row = record(item);
    const startMs = typeof row.start_ms === "number" ? row.start_ms : null;
    const endMs = typeof row.end_ms === "number" ? row.end_ms : null;
    if (startMs === null || endMs === null || endMs <= startMs) return [];
    return [{
      id: String(row.id ?? index),
      label: typeof row.label === "string" ? row.label : typeof row.type === "string" ? row.type : `Section ${index + 1}`,
      startMs,
      endMs,
      energy: typeof row.energy === "number" ? row.energy : null,
    }];
  }) : [];
  return {
    durationMs,
    bpm: typeof map.bpm === "number" ? map.bpm : null,
    beats: [...new Set(beats)].sort((a, b) => a - b),
    downbeats: [...new Set(downbeats)].sort((a, b) => a - b),
    editPoints: [...new Set(editPoints)].sort((a, b) => a - b),
    energy: timedItems(map.energy_curve),
    sections,
  };
}

export function smartSnapTime(ms: number, map: EditorMusicMap, mode: "off" | "beats" | "smart", thresholdMs = 180) {
  if (mode === "off") return Math.max(0, Math.min(map.durationMs, Math.round(ms)));
  const candidates = mode === "beats"
    ? [...map.beats, ...map.downbeats]
    : [...map.editPoints, ...map.downbeats, ...map.beats, ...map.sections.flatMap((section) => [section.startMs, section.endMs])];
  let best = ms;
  let distance = thresholdMs + 1;
  for (const point of candidates) {
    const nextDistance = Math.abs(point - ms);
    if (nextDistance < distance) {
      best = point;
      distance = nextDistance;
    }
  }
  return Math.max(0, Math.min(map.durationMs, Math.round(distance <= thresholdMs ? best : ms)));
}

export function formatEditorTime(ms: number) {
  const totalMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const frames = Math.floor(((totalMs % 1000) / 1000) * 25);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

export function shotReadiness(shot: ExtendedMusicVideoShot, characters: MusicVideoCharacter[], hasAudio: boolean) {
  const issues: string[] = [];
  if (shot.end_ms <= shot.start_ms) issues.push("Invalid timing");
  if (shot.shot_type === "performance") {
    if (!hasAudio) issues.push("Performance needs track audio");
    if (!shot.character_id) issues.push("Choose a performer");
    const character = characters.find((item) => item.id === shot.character_id);
    if (character && (!Array.isArray(character.reference_asset_ids) || character.reference_asset_ids.length === 0)) issues.push("Add identity references");
  }
  if (shot.shot_type === "source_media" && !shot.selected_asset_id) issues.push("Choose source media");
  if (shot.shot_type === "generated" && !shot.prompt) issues.push("Prompt is empty");
  const params = record(shot.generation_params);
  if (params.vertical_safe === false) issues.push("Vertical crop needs review");
  return {
    score: Math.max(0, 100 - issues.length * 22),
    issues,
    ready: issues.length === 0,
  };
}

function frames(ms: number, fps = 25) {
  return Math.max(0, Math.round((ms / 1000) * fps));
}

function edlTimecode(frameCount: number, fps = 25) {
  const framesPerHour = fps * 60 * 60;
  const framesPerMinute = fps * 60;
  const hours = Math.floor(frameCount / framesPerHour);
  const minutes = Math.floor((frameCount % framesPerHour) / framesPerMinute);
  const seconds = Math.floor((frameCount % framesPerMinute) / fps);
  const frame = frameCount % fps;
  return [hours, minutes, seconds, frame].map((part) => String(part).padStart(2, "0")).join(":");
}

export function buildCmx3600Edl(title: string, shots: ExtendedMusicVideoShot[]) {
  const ordered = [...shots].sort((a, b) => a.start_ms - b.start_ms || a.display_order - b.display_order);
  const lines = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""];
  ordered.forEach((shot, index) => {
    const sourceIn = 0;
    const sourceOut = frames(shot.end_ms - shot.start_ms);
    const recordIn = frames(shot.start_ms);
    const recordOut = frames(shot.end_ms);
    lines.push(
      `${String(index + 1).padStart(3, "0")}  ${shot.selected_asset_id ? shot.selected_asset_id.slice(0, 8).toUpperCase() : "ENSEMBLS"} V     C        ${edlTimecode(sourceIn)} ${edlTimecode(sourceOut)} ${edlTimecode(recordIn)} ${edlTimecode(recordOut)}`,
      `* FROM CLIP NAME: ${shot.description.replace(/\s+/g, " ").slice(0, 120)}`,
      "",
    );
  });
  return lines.join("\n");
}

function xmlEscape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function buildFcpxml(title: string, shots: ExtendedMusicVideoShot[]) {
  const ordered = [...shots].sort((a, b) => a.start_ms - b.start_ms || a.display_order - b.display_order);
  const duration = Math.max(1, ...ordered.map((shot) => shot.end_ms));
  const clips = ordered.map((shot, index) => {
    const offset = `${Math.round(shot.start_ms * 25)}/25000s`;
    const clipDuration = `${Math.max(1, Math.round((shot.end_ms - shot.start_ms) * 25))}/25000s`;
    return `            <gap name="${xmlEscape(shot.description || `Shot ${index + 1}`)}" offset="${offset}" duration="${clipDuration}"/>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.11">\n  <resources>\n    <format id="r1" name="FFVideoFormat1080p25" frameDuration="1/25s" width="1920" height="1080"/>\n  </resources>\n  <library><event name="Ensemblis"><project name="${xmlEscape(title)}"><sequence format="r1" duration="${Math.round(duration * 25)}/25000s" tcStart="0s" tcFormat="NDF"><spine>\n${clips}\n          </spine></sequence></project></event></library>\n</fcpxml>`;
}
