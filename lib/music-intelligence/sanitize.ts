import type { Json } from "@/types/database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sentinelSection(value: unknown) {
  const section = record(value);
  const label = typeof section.label === "string" ? section.label.trim().toLowerCase() : "";
  return label === "start" || label === "end";
}

/**
 * All-In-One uses tiny `start` / `end` segments as sentinel boundaries in its public result
 * contract. They are not musical sections. Strip them, and every dependent reference to them,
 * before a worker map can become canonical or drive production decisions.
 */
export function sanitizeMusicIntelligenceMap(input: Record<string, unknown>): Record<string, unknown> {
  const map = { ...input };
  const sections = Array.isArray(map.sections) ? map.sections : [];
  const removedSections = sections.filter(sentinelSection).map(record);
  if (!removedSections.length) return map;

  const removedSectionIds = new Set(
    removedSections
      .map((section) => typeof section.id === "string" ? section.id : null)
      .filter((id): id is string => Boolean(id)),
  );
  const removedLabels = new Set(["start", "end"]);
  const durationMs = typeof map.duration_ms === "number" ? map.duration_ms : 0;
  const removedBoundaryMs = new Set(
    removedSections.flatMap((section) => {
      const values: number[] = [];
      if (typeof section.start_ms === "number") values.push(section.start_ms);
      if (typeof section.end_ms === "number") values.push(section.end_ms);
      return values;
    }),
  );

  map.sections = sections.filter((section) => !sentinelSection(section));

  if (Array.isArray(map.edit_points)) {
    map.edit_points = map.edit_points.filter((value) => {
      const point = record(value);
      const reason = typeof point.reason === "string" ? point.reason.toLowerCase() : "";
      if (reason.includes("transition into start") || reason.includes("transition into end")) return false;
      const ms = typeof point.ms === "number" ? point.ms : null;
      if (ms === null || !removedBoundaryMs.has(ms)) return true;
      return ms > 100 && (!durationMs || ms < durationMs - 100);
    });
  }

  if (Array.isArray(map.bars)) {
    map.bars = map.bars.filter((value) => {
      const sectionId = record(value).section_id;
      return typeof sectionId !== "string" || !removedSectionIds.has(sectionId);
    });
  }
  if (Array.isArray(map.phrases)) {
    map.phrases = map.phrases.filter((value) => {
      const sectionId = record(value).section_id;
      return typeof sectionId !== "string" || !removedSectionIds.has(sectionId);
    });
  }

  const candidates = Array.isArray(map.hook_candidates) ? map.hook_candidates : [];
  const cleanCandidates = candidates.filter((value) => {
    const candidate = record(value);
    const label = typeof candidate.section_label === "string" ? candidate.section_label.trim().toLowerCase() : "";
    return !removedLabels.has(label);
  });
  map.hook_candidates = cleanCandidates;
  const validCandidateIds = new Set(
    cleanCandidates
      .map((candidate) => record(candidate).id)
      .filter((id): id is string => typeof id === "string"),
  );

  if (map.moments && typeof map.moments === "object" && !Array.isArray(map.moments)) {
    map.moments = Object.fromEntries(
      Object.entries(record(map.moments)).map(([intent, values]) => [
        intent,
        Array.isArray(values)
          ? values.filter((value) => {
              const id = record(value).candidate_id;
              return typeof id !== "string" || validCandidateIds.has(id);
            })
          : values,
      ]),
    );
  }

  const socialOptions = record(map.social_cut_options);
  const cleanSocialOptions: Record<string, unknown> = {};
  for (const [duration, values] of Object.entries(socialOptions)) {
    cleanSocialOptions[duration] = Array.isArray(values)
      ? values.filter((value) => {
          const id = record(value).candidate_id;
          return typeof id !== "string" || validCandidateIds.has(id);
        })
      : values;
  }
  if (Object.keys(socialOptions).length) map.social_cut_options = cleanSocialOptions;

  if (map.social_cuts && typeof map.social_cuts === "object" && !Array.isArray(map.social_cuts)) {
    const cuts = record(map.social_cuts);
    const cleanCuts: Record<string, unknown> = {};
    for (const [duration, value] of Object.entries(cuts)) {
      const candidateId = record(value).candidate_id;
      if (value && typeof candidateId === "string" && !validCandidateIds.has(candidateId)) {
        const alternatives = cleanSocialOptions[duration];
        cleanCuts[duration] = Array.isArray(alternatives) && alternatives.length ? alternatives[0] : null;
      } else {
        cleanCuts[duration] = value;
      }
    }
    map.social_cuts = cleanCuts;
  }

  const analysis = record(map.analysis);
  const warnings = Array.isArray(analysis.warnings) ? analysis.warnings : [];
  map.analysis = {
    ...analysis,
    warnings: [
      ...warnings,
      "All-In-One start/end sentinel boundaries were excluded from the musical section map.",
    ],
  };
  return map;
}

export function sanitizeMusicIntelligenceJson(input: Record<string, unknown>): Json {
  return sanitizeMusicIntelligenceMap(input) as Json;
}
