import type { Json, Release, Track } from "@/types/database";
import type {
  DistributionReleaseMetadata,
  DistributionTrackContributor,
  DistributionTrackMetadata,
  DistributionTrackWriter,
} from "@/types/distribution-database";

export type DistributionHandoffInput = {
  release: Release;
  tracks: Track[];
  releaseMetadata: DistributionReleaseMetadata | null;
  trackMetadata: DistributionTrackMetadata[];
  writers: DistributionTrackWriter[];
  contributors: DistributionTrackContributor[];
  rights: Json | null;
  aiProvenance: Json | null;
  masterGates: Record<string, string | null>;
  decisions: Array<{ key: string; title: string; detail: string }>;
  exportedAt: string;
};

/**
 * Private preparation-only snapshot for a distributor used outside Ensemblis.
 * It intentionally does not include signed storage URLs, grant legal rights,
 * submit to any DSP or mutate canonical release metadata.
 */
export function buildDistributionHandoff(input: DistributionHandoffInput) {
  const release = input.release;
  const metadata = input.releaseMetadata;
  const trackMetadata = new Map(input.trackMetadata.map((row) => [row.track_id, row]));
  return {
    schema: "ensemblis-distribution-handoff-v1",
    exportedAt: input.exportedAt,
    submissionStatus: "NOT_SUBMITTED",
    approvalStatus: "ARTIST_REVIEW_REQUIRED",
    warning: "Preparation only. This export is not proof of ownership, clearance, approval, distributor acceptance or availability in stores. Verify rights, audio and provider requirements yourself before an external submission.",
    release: {
      title: release.title,
      artist: release.artist ?? null,
      releaseType: release.release_type,
      releaseDate: release.release_date,
      genre: release.genre ?? null,
      subgenre: release.subgenre ?? null,
      label: release.label ?? null,
      upc: release.upc ?? null,
      upcAssignment: metadata?.upc_source ?? null,
      metadataLanguage: metadata?.metadata_language_code ?? null,
      catalogNumber: metadata?.catalog_number ?? null,
      originalReleaseDate: metadata?.original_release_date ?? null,
      preorderDate: metadata?.preorder_date ?? null,
      productCopyright: metadata?.product_copyright_line ?? null,
      recordingCopyright: metadata?.recording_copyright_line ?? null,
      artworkAttached: Boolean(release.artwork_url || release.cover_asset),
    },
    tracks: input.tracks.map((track, index) => {
      const meta = trackMetadata.get(track.id);
      const writers = input.writers.filter((item) => item.track_id === track.id);
      return {
        position: track.track_number ?? track.display_order ?? index + 1,
        title: track.title,
        version: track.version ?? null,
        durationSeconds: track.duration ?? null,
        isrc: meta?.isrc ?? null,
        metadataLanguage: meta?.metadata_language_code ?? null,
        audioLanguage: meta?.audio_language_code ?? null,
        explicit: meta?.explicit ?? null,
        origin: meta?.track_origin ?? null,
        masterAttached: Boolean(track.audio_url),
        masterVerification: input.masterGates[track.id] ?? "unverified",
        // A portable handoff does not contain private/signed source URLs.
        masterFileInstruction: "Select the exact artist-approved canonical master from Ensemblis Music; do not replace it with a preview or an unapproved mastering candidate.",
        writers: writers.map(({ legal_name, role, share, publishing_type, publisher_name }) => ({
          legalName: legal_name, role, share, publishingType: publishing_type, publisherName: publisher_name,
        })),
        contributors: input.contributors.filter((item) => item.track_id === track.id)
          .map(({ name, role }) => ({ name, role })),
      };
    }),
    artistDeclaredRights: input.rights,
    artistDeclaredAiProvenance: input.aiProvenance,
    unresolvedDecisions: input.decisions.map((issue) => ({
      key: issue.key,
      title: issue.title,
      detail: issue.detail,
    })),
    nextSteps: [
      "Resolve all unresolved decisions and listen to the exact final masters.",
      "Re-check the chosen distributor's current format, artwork, credit, AI and rights requirements.",
      "Upload audio and cover through that distributor using the canonical facts above.",
      "Capture the distributor submission receipt and actual store URLs separately. This export does not change release status in Ensemblis.",
    ],
  };
}
