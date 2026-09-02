import type { Json, Release, Track } from "@/types/database";
import type { DistributionTrackMetadata } from "@/types/distribution-database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export type DistributionUpdateBaseline = {
  submissionId: string;
  version: number;
  metadataSnapshot: Json;
  assetSnapshot: Json;
  destinationSnapshot: Json;
};

export type DistributionProviderAssignedIdentity = {
  upc?: string | null;
  tracks?: Array<{
    trackId: string;
    isrc?: string | null;
    providerTrackId?: string;
    audioId?: string | null;
    audioFilename?: string | null;
    fileFormat?: number | null;
  }>;
};

export function assertSafeDistributedReleaseUpdate(input: {
  release: Release;
  tracks: Track[];
  trackMetadata: DistributionTrackMetadata[];
  baseline: DistributionUpdateBaseline;
  providerIdentity?: DistributionProviderAssignedIdentity | null;
}) {
  const metadata = record(input.baseline.metadataSnapshot);
  const baselineRelease = record(metadata.release);
  const baselineTracks = records(metadata.tracks);
  const baselineTrackMetadata = records(metadata.trackMetadata);
  const assets = record(input.baseline.assetSnapshot);
  const baselineMasters = records(assets.trackMasters);
  const providerTracks = new Map((input.providerIdentity?.tracks ?? []).map((item) => [item.trackId, item]));
  const issues: string[] = [];

  if (!baselineTracks.length || !baselineMasters.length) {
    throw new Error("The latest immutable submission does not contain enough identity evidence for a safe in-place correction. Use takedown + new release instead.");
  }

  const submittedUpc = normalized(baselineRelease.upc);
  const authoritativeUpc = submittedUpc || normalized(input.providerIdentity?.upc);
  const currentUpc = normalized(input.release.upc);
  if (!authoritativeUpc) {
    throw new Error("The provider UPC has not been synchronized yet. Refresh distribution status before starting a correction.");
  }
  if (currentUpc !== authoritativeUpc) issues.push("UPC changed");

  if (input.tracks.length !== baselineTracks.length) {
    issues.push("track count changed");
  } else {
    for (let index = 0; index < input.tracks.length; index += 1) {
      const current = input.tracks[index];
      const previous = baselineTracks[index];
      if (String(current.id) !== String(previous.id ?? "")) {
        issues.push(`track order changed at position ${index + 1}`);
        break;
      }
    }
  }

  const currentMetadata = new Map(input.trackMetadata.map((item) => [item.track_id, item]));
  const previousMetadata = new Map(baselineTrackMetadata.map((item) => [String(item.track_id ?? ""), item]));
  const previousMasters = new Map(baselineMasters.map((item) => [String(item.trackId ?? ""), item]));
  for (const track of input.tracks) {
    const current = currentMetadata.get(track.id);
    const previous = previousMetadata.get(track.id);
    if (!previous) {
      issues.push(`missing submitted identity evidence for '${track.title}'`);
      continue;
    }
    const submittedIsrc = normalized(previous.isrc);
    const providerIsrc = normalized(providerTracks.get(track.id)?.isrc);
    const authoritativeIsrc = submittedIsrc || providerIsrc;
    if (!authoritativeIsrc) {
      issues.push(`provider ISRC is not synchronized for '${track.title}'`);
    } else if (normalized(current?.isrc) !== authoritativeIsrc) {
      issues.push(`ISRC changed for '${track.title}'`);
    }
    const previousMaster = previousMasters.get(track.id);
    if (!previousMaster) {
      issues.push(`missing submitted master evidence for '${track.title}'`);
    } else if (String(track.audio_url ?? "") !== String(previousMaster.audioUrl ?? "")) {
      issues.push(`master audio changed for '${track.title}'`);
    }
  }

  if (issues.length) {
    throw new Error(`This correction changes distributed release identity (${issues.join("; ")}). Ensemblis will not overwrite the live release. Request a takedown and create a new release instead.`);
  }

  return {
    safe: true as const,
    baselineSubmissionId: input.baseline.submissionId,
    baselineVersion: input.baseline.version,
  };
}

export function updateModeFromProviderMetadata(value: Json | null | undefined) {
  const metadata = record(value);
  const mode = record(metadata.updateMode);
  const active = mode.active === true;
  return {
    active,
    baselineSubmissionId: active ? String(mode.baselineSubmissionId ?? "") : "",
    baselineVersion: active ? Number(mode.baselineVersion ?? 0) : 0,
    previousState: active ? String(mode.previousState ?? "") : "",
    startedAt: active ? String(mode.startedAt ?? "") : "",
  };
}
