import type { Json } from "@/types/database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function MasteringTechnicalReport({ musicMap }: { musicMap: Json }) {
  const inspector = record(record(musicMap).mastering_inspector);
  if (!Object.keys(inspector).length) return null;

  return (
    <details className="workspace-drawer">
      <summary>Full technical mastering report</summary>
      <p className="v2-muted-copy">
        Every deterministic Mastering Inspector field returned by the analyzer. This is the complete technical payload behind the artist-facing report above.
      </p>
      <pre
        style={{
          maxHeight: "32rem",
          overflow: "auto",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontSize: "0.76rem",
          lineHeight: 1.55,
        }}
      >
        {JSON.stringify(inspector, null, 2)}
      </pre>
    </details>
  );
}
