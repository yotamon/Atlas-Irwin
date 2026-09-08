import type { Json } from "@/types/database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

type ActivityPoint = {
  startMs: number;
  endMs: number;
  energy: number;
  activeRatio: number;
  rhythmicActivity: number;
  active: boolean;
};

function clamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function parseStemActivityCurve(analysis: Json, durationMs: number): ActivityPoint[] {
  const raw = record(analysis).activity_curve;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const row = record(item);
    const startMs = typeof row.start_ms === "number" ? Math.max(0, row.start_ms) : null;
    const endMs = typeof row.end_ms === "number" ? Math.min(durationMs, row.end_ms) : null;
    if (startMs === null || endMs === null || endMs <= startMs) return [];
    return [{
      startMs,
      endMs,
      energy: clamp(row.energy),
      activeRatio: clamp(row.active_ratio),
      rhythmicActivity: clamp(row.rhythmic_activity),
      active: row.active === true,
    }];
  });
}

export function StemActivityLane({ analysis, durationMs }: { analysis: Json; durationMs: number }) {
  const points = parseStemActivityCurve(analysis, durationMs);
  if (!points.length) return <div className="video-editor-stem-lane is-empty"><span>No activity analysis</span></div>;
  return (
    <div className="video-editor-stem-lane" aria-label="Stem activity from Stem Intelligence">
      {points.map((point, index) => {
        const value = Math.max(point.energy, point.rhythmicActivity * 0.9, point.activeRatio * 0.72);
        return <i
          key={`${point.startMs}-${index}`}
          className={point.active ? "is-active" : ""}
          title={`${(point.startMs / 1000).toFixed(1)}s · energy ${Math.round(point.energy * 100)}% · rhythm ${Math.round(point.rhythmicActivity * 100)}%`}
          style={{
            left: `${(point.startMs / durationMs) * 100}%`,
            width: `${Math.max(0.12, ((point.endMs - point.startMs) / durationMs) * 100)}%`,
            height: `${Math.max(8, value * 92)}%`,
          }}
        />;
      })}
    </div>
  );
}
