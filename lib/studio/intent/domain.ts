export type StudioIntentKind =
  | "add_music"
  | "open_object"
  | "continue_work"
  | "create_from_object"
  | "master_track"
  | "mix_music"
  | "prepare_release"
  | "promote_release"
  | "release_readiness"
  | "release_results"
  | "today_priority"
  | "needs_you"
  | "connect_library"
  | "unknown";

export type StudioIntentObjectType = "track" | "release" | "mix" | "any";

export type ClassifiedStudioIntent = {
  kind: StudioIntentKind;
  objectType: StudioIntentObjectType;
  objectQuery: string;
  desiredOutcome: string | null;
  createMode?: "static" | "motion" | null;
  confidence: "high" | "medium" | "low";
  source: "deterministic" | "semantic";
};

const POLITE = /\b(?:please|pls|can you|could you|would you|help me|i want to|i need to|i'd like to|i would like to)\b/gi;
const POSSESSIVE = /\b(?:my|the)\b/gi;
const RELATIVE_OBJECT = /\b(?:latest|newest|current|active)\b/gi;
const SPACE = /\s+/g;

function clean(value: string) {
  return value
    .replace(/[“”"']/g, "")
    .replace(/[?!.,;:]+/g, " ")
    .replace(POLITE, " ")
    .replace(SPACE, " ")
    .trim();
}

function cleanObject(value: string) {
  return clean(value)
    .replace(POSSESSIVE, " ")
    .replace(RELATIVE_OBJECT, " ")
    .replace(/\b(?:track|song|release|single|album|ep|mix|dj set)\b/gi, " ")
    .replace(SPACE, " ")
    .trim();
}

function createIntent(query: string): ClassifiedStudioIntent | null {
  const lower = query.toLowerCase();
  const releaseVisualStaticIntent = (
    /\b(?:out now|out friday|pre[- ]?save|listen now)\b/.test(lower)
    && /\b(?:story|post|artwork|visual|cover|instagram)\b/.test(lower)
  ) || /\b(?:release visual|release post)\b/.test(lower)
    || /\b(?:cover|artwork)\b.*\b(?:fit|for|to)\b.*\binstagram\b/.test(lower);
  if (releaseVisualStaticIntent) {
    return {
      kind: "create_from_object",
      objectType: "release",
      objectQuery: cleanObject(
        query
          .replace(/\b(?:make|create|generate|turn|fit)\b/gi, " ")
          .replace(/\b(?:out now|out friday|pre[- ]?save|listen now|instagram|story|post|artwork|visual|cover)\b/gi, " ")
          .replace(/\b(?:this|a|an|the|from|for|using|into|to)\b/gi, " "),
      ),
      desiredOutcome: "visual",
      createMode: "static",
      confidence: "high",
      source: "deterministic",
    };
  }
  const livingArtworkIntent = /\bvisualizer\b/.test(lower) || (
    /\b(?:animate|loop|looping)\b/.test(lower)
    && /\b(?:artwork|cover|visual|image)\b/.test(lower)
  ) || /\b(?:reel|story|short)\s+background\b.*\b(?:artwork|cover|visual|image)\b/.test(lower);
  if (livingArtworkIntent) {
    return {
      kind: "create_from_object",
      objectType: "any",
      objectQuery: cleanObject(
        query
          .replace(/\b(?:animate|loop|looping|visualizer|make|create|generate|turn)\b/gi, " ")
          .replace(/\b(?:this|a|an|the|artwork|cover|visual|image|visualizer|loop|reel|story|short|background)\b/gi, " ")
          .replace(/\b(?:from|for|using|into)\b/gi, " "),
      ),
      desiredOutcome: "visual",
      createMode: "motion",
      confidence: "high",
      source: "deterministic",
    };
  }
  const createMatch = query.match(/(?:make|create|generate|turn)\s+(?:me\s+)?(?:an?\s+)?(.+?)\s+(?:from|for|using)\s+(.+)/i);
  if (createMatch) {
    const desiredOutcome = clean(createMatch[1]).replace(/\b(?:content|asset)\b/gi, "").trim() || "creative";
    if (/^(?:dj\s+)?(?:mix|set)$/i.test(desiredOutcome)) {
      return {
        kind: "mix_music",
        objectType: "track",
        objectQuery: cleanObject(createMatch[2]),
        desiredOutcome: null,
        confidence: "high",
        source: "deterministic",
      };
    }
    return {
      kind: "create_from_object",
      objectType: /release|album|ep|single/i.test(createMatch[2]) ? "release" : "track",
      objectQuery: cleanObject(createMatch[2]),
      desiredOutcome,
      confidence: "high",
      source: "deterministic",
    };
  }
  if (/\b(?:make|create|generate)\b/.test(lower) && /\b(?:reel|short|clip|video|visualizer|artwork|cover|post|story|tiktok|instagram)\b/.test(lower)) {
    return {
      kind: "create_from_object",
      objectType: "any",
      objectQuery: cleanObject(
        query
          .replace(/\b(?:make|create|generate)\b/gi, " ")
          .replace(/\b(?:a|an|reel|short|clip|video|visualizer|artwork|cover|post|story|tiktok|instagram)\b/gi, " ")
          .replace(/\b(?:from|for|using)\b/gi, " "),
      ),
      desiredOutcome: (lower.match(/\b(reel|short|clip|video|visualizer|artwork|cover|post|story|tiktok|instagram)\b/)?.[1] ?? "creative"),
      confidence: "medium",
      source: "deterministic",
    };
  }
  return null;
}

export function classifyStudioIntent(rawQuery: string): ClassifiedStudioIntent {
  const query = clean(rawQuery);
  const lower = query.toLowerCase();

  if (!query) {
    return { kind: "unknown", objectType: "any", objectQuery: "", desiredOutcome: null, confidence: "low", source: "deterministic" };
  }

  if (/\b(?:what should i (?:work on|do)|what(?:'s| is) next|next action|best next move|what matters now)\b/.test(lower)) {
    return { kind: "today_priority", objectType: "any", objectQuery: "", desiredOutcome: null, confidence: "high", source: "deterministic" };
  }

  if (/\b(?:what needs me|needs me|needs you|decisions?|approvals?)\b/.test(lower)) {
    return { kind: "needs_you", objectType: "any", objectQuery: "", desiredOutcome: null, confidence: "high", source: "deterministic" };
  }

  if (/\b(?:connect|pair|setup|set up)\b/.test(lower) && /\b(?:rekordbox|music library|computer|desktop|local library)\b/.test(lower)) {
    return { kind: "connect_library", objectType: "any", objectQuery: "", desiredOutcome: null, confidence: "high", source: "deterministic" };
  }

  if (/\b(?:add|upload|import)\b/.test(lower) && /\b(?:music|track|song|master|audio|release)\b/.test(lower)) {
    return { kind: "add_music", objectType: "any", objectQuery: "", desiredOutcome: null, confidence: "high", source: "deterministic" };
  }

  const created = createIntent(query);
  if (created) return created;

  if (/\b(?:is|are)\b.*\b(?:ready|prepared)\b/.test(lower) || /\bready\s+(?:to|for)\s+(?:release|distribute|distribution)\b/.test(lower)) {
    const objectQuery = cleanObject(
      query
        .replace(/^.*?\b(?:is|are)\b/i, " ")
        .replace(/\b(?:ready|prepared)(?:\s+(?:to|for)\s+(?:release|distribute|distribution))?.*$/i, " "),
    );
    return { kind: "release_readiness", objectType: "release", objectQuery, desiredOutcome: null, confidence: "high", source: "deterministic" };
  }

  if (/\bhow\s+(?:is|did)\b/.test(lower) && /\b(?:doing|perform|performing|results?|streams?|growth)\b/.test(lower)) {
    const objectQuery = cleanObject(
      query
        .replace(/^.*?\bhow\s+(?:is|did)\b/i, " ")
        .replace(/\b(?:doing|perform|performing|results?|streams?|growth).*$/i, " "),
    );
    return { kind: "release_results", objectType: "release", objectQuery, desiredOutcome: null, confidence: "high", source: "deterministic" };
  }

  if (/\b(?:master|mastering)\b/.test(lower)) {
    const objectQuery = cleanObject(query.replace(/\b(?:master|mastering|check|fix|improve)\b/gi, " "));
    return { kind: "master_track", objectType: "track", objectQuery, desiredOutcome: null, confidence: "high", source: "deterministic" };
  }

  if (/\b(?:prepare|get)\b/.test(lower) && /\b(?:release|single|album|ep|spotify|distribution|distribute)\b/.test(lower)) {
    const objectQuery = cleanObject(query.replace(/\b(?:prepare|get|ready|for|spotify|distribution|distribute)\b/gi, " "));
    return { kind: "prepare_release", objectType: "release", objectQuery, desiredOutcome: null, confidence: "medium", source: "deterministic" };
  }

  if (/\b(?:promote|promotion|market|marketing)\b/.test(lower)) {
    const objectQuery = cleanObject(query.replace(/\b(?:promote|promotion|market|marketing)\b/gi, " "));
    return { kind: "promote_release", objectType: "release", objectQuery, desiredOutcome: null, confidence: "high", source: "deterministic" };
  }

  if (/\b(?:continue|resume|pick up)\b/.test(lower)) {
    const objectType: StudioIntentObjectType = /\b(?:mix|dj set)\b/.test(lower) ? "mix" : /\brelease\b/.test(lower) ? "release" : /\b(?:track|song)\b/.test(lower) ? "track" : "any";
    const objectQuery = cleanObject(query.replace(/\b(?:continue|resume|pick up|where i left off|latest|last)\b/gi, " "));
    return { kind: "continue_work", objectType, objectQuery, desiredOutcome: null, confidence: "high", source: "deterministic" };
  }

  if (/\b(?:mix|dj mix|dj set|automix)\b/.test(lower) && /\b(?:make|create|build|mix|dj|automix)\b/.test(lower)) {
    const objectQuery = cleanObject(query.replace(/\b(?:make|create|build|mix|dj|set|automix|from|using)\b/gi, " "));
    return { kind: "mix_music", objectType: objectQuery ? "track" : "any", objectQuery, desiredOutcome: null, confidence: "high", source: "deterministic" };
  }

  if (/\b(?:latest|newest|current|active)\s+release\b/.test(lower)) {
    return { kind: "open_object", objectType: "release", objectQuery: "", desiredOutcome: null, confidence: "high", source: "deterministic" };
  }

  if (/\b(?:latest|newest|current)\s+(?:track|song)\b/.test(lower)) {
    return { kind: "open_object", objectType: "track", objectQuery: "", desiredOutcome: null, confidence: "high", source: "deterministic" };
  }

  return {
    kind: "open_object",
    objectType: "any",
    objectQuery: cleanObject(query),
    desiredOutcome: null,
    confidence: "low",
    source: "deterministic",
  };
}

export function semanticIntentSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["kind", "objectType", "objectQuery", "desiredOutcome"],
    properties: {
      kind: {
        type: "string",
        enum: [
          "add_music",
          "open_object",
          "continue_work",
          "create_from_object",
          "master_track",
          "mix_music",
          "prepare_release",
          "promote_release",
          "release_readiness",
          "release_results",
          "today_priority",
          "needs_you",
          "connect_library",
          "unknown",
        ],
      },
      objectType: { type: "string", enum: ["track", "release", "mix", "any"] },
      objectQuery: { type: "string" },
      desiredOutcome: { anyOf: [{ type: "string" }, { type: "null" }] },
      createMode: { anyOf: [{ type: "string", enum: ["static", "motion"] }, { type: "null" }] },
    },
  } as const;
}
