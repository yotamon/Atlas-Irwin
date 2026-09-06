import type { ArtistSceneRelationship } from "@/lib/artist-operating/domain";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function hasUsableSceneEvidence(value: unknown) {
  const evidence = record(value);
  if (!Object.keys(evidence).length) return false;
  const sources = Array.isArray(evidence.sources) ? evidence.sources : [];
  return sources.length > 0 || typeof evidence.source === "string" || typeof evidence.reason === "string";
}

export function usableSceneRelationships(
  relationships: ArtistSceneRelationship[],
  now = new Date(),
) {
  return relationships
    .filter((relationship) => {
      if (relationship.status === "candidate" && relationship.confidence < 0.35) return false;
      if (!hasUsableSceneEvidence(relationship.evidence)) return false;
      if (relationship.expiresAt && new Date(relationship.expiresAt) <= now) return false;
      return true;
    })
    .sort((left, right) =>
      right.fitScore - left.fitScore || right.confidence - left.confidence,
    );
}

export function sceneRelationshipOpportunityKind(type: ArtistSceneRelationship["type"]) {
  if (type === "label") return "label_fit" as const;
  if (type === "playlist") return "playlist_fit" as const;
  if (type === "channel") return "channel_fit" as const;
  if (type === "promoter" || type === "venue" || type === "festival") return "gig_fit" as const;
  return "scene_fit" as const;
}
