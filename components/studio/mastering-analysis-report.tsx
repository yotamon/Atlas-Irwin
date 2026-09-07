import type { Json } from "@/types/database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatNumber(key: string, value: number) {
  const normalized = key.toLowerCase();
  if (normalized.includes("duration_ms") || normalized.endsWith("_ms")) {
    const seconds = value / 1000;
    return seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : `${seconds.toFixed(2)} s`;
  }
  if (normalized.includes("lufs")) return `${value.toFixed(1)} LUFS`;
  if (normalized.includes("dbtp") || normalized.includes("true_peak")) return `${value.toFixed(2)} dBTP`;
  if (normalized.includes("db")) return `${value.toFixed(2)} dB`;
  if (normalized.includes("ratio_lu") || normalized.includes("plr")) return `${value.toFixed(1)} LU`;
  if (normalized.includes("hz")) return `${Math.round(value).toLocaleString("en")} Hz`;
  if (normalized.includes("percent") || normalized.endsWith("_pct")) return `${value.toFixed(1)}%`;
  if (Number.isInteger(value)) return value.toLocaleString("en");
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatValue(key: string, value: unknown) {
  if (typeof value === "boolean") return value ? "Pass" : "Review";
  if (typeof value === "number" && Number.isFinite(value)) return formatNumber(key, value);
  if (typeof value === "string") return value.replaceAll("_", " ");
  if (value === null || value === undefined) return "Not measured";
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  return "Measured";
}

type Metric = { key: string; label: string; value: unknown };

function flattenMetrics(value: unknown, prefix = "", depth = 0): Metric[] {
  if (depth > 3) return [];
  const source = record(value);
  return Object.entries(source).flatMap(([key, next]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (next && typeof next === "object" && !Array.isArray(next)) {
      return flattenMetrics(next, path, depth + 1);
    }
    return [{ key: path, label: humanize(key), value: next }];
  });
}

function MetricList({ value }: { value: unknown }) {
  const metrics = flattenMetrics(value);
  if (!metrics.length) return <p className="mastering-report-empty">No additional measurements were recorded for this section.</p>;
  return (
    <dl className="mastering-report-metrics">
      {metrics.map((metric) => (
        <div key={metric.key}>
          <dt>{metric.label}</dt>
          <dd>{formatValue(metric.key, metric.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function CheckList({ value }: { value: unknown }) {
  const checks = Object.entries(record(value));
  if (!checks.length) return null;
  return (
    <div className="mastering-report-checks">
      {checks.map(([key, check]) => {
        const passed = check === true || check === "pass" || check === "passed";
        const failed = check === false || check === "fail" || check === "failed";
        return (
          <div key={key} data-state={passed ? "pass" : failed ? "review" : "neutral"}>
            <span aria-hidden>{passed ? "✓" : failed ? "!" : "·"}</span>
            <strong>{humanize(key)}</strong>
            <small>{formatValue(key, check)}</small>
          </div>
        );
      })}
    </div>
  );
}

export function MasteringAnalysisReport({ result, compact = false }: { result: Json; compact?: boolean }) {
  const payload = record(result);
  const before = payload.before;
  const after = payload.after;
  const checks = payload.final_checks;
  const iterations = Array.isArray(payload.iterations) ? payload.iterations : [];
  const reserved = new Set(["before", "after", "final_checks", "iterations"]);
  const evidence = Object.fromEntries(Object.entries(payload).filter(([key]) => !reserved.has(key)));

  return (
    <div className={`mastering-report${compact ? " is-compact" : ""}`}>
      {checks ? (
        <section>
          <header><span>Verification</span><strong>Final checks</strong></header>
          <CheckList value={checks} />
        </section>
      ) : null}

      {before || after ? (
        <section>
          <header><span>Measurements</span><strong>Source vs rendered master</strong></header>
          <div className="mastering-report-columns">
            <div><h4>Original</h4><MetricList value={before} /></div>
            <div><h4>Mastered</h4><MetricList value={after} /></div>
          </div>
        </section>
      ) : null}

      {iterations.length ? (
        <section>
          <header><span>Render evidence</span><strong>{iterations.length} render pass{iterations.length === 1 ? "" : "es"}</strong></header>
          <div className="mastering-report-iterations">
            {iterations.map((iteration, index) => (
              <details key={index} open={!compact && index === iterations.length - 1}>
                <summary>Pass {index + 1}</summary>
                <MetricList value={iteration} />
              </details>
            ))}
          </div>
        </section>
      ) : null}

      {Object.keys(evidence).length ? (
        <section>
          <header><span>Technical evidence</span><strong>Complete measured payload</strong></header>
          <MetricList value={evidence} />
        </section>
      ) : null}
    </div>
  );
}
