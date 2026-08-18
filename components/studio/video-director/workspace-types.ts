import type { MediaAsset, MusicVideoConcept, MusicVideoRender, MusicVideoScene, Release, Track } from "@/types/database";
import type {
  ExtendedMusicVideoApproval,
  ExtendedMusicVideoGeneration,
  ExtendedMusicVideoProject,
  ExtendedMusicVideoShot,
  MusicVideoWorkerJob,
} from "@/types/video-database";

export type VideoServiceReadiness = {
  director: { configured: boolean; model: string };
  higgsfield: {
    hasCredentials: boolean;
    configuredModels: string[];
    inferredEndpointsEnabled: boolean;
    hasConfiguredRates: boolean;
  };
  worker: { configured: boolean; url: string | null };
};

export type VideoWorkspaceData = {
  project: ExtendedMusicVideoProject;
  release: Release;
  track: Track;
  concepts: MusicVideoConcept[];
  scenes: MusicVideoScene[];
  shots: ExtendedMusicVideoShot[];
  generations: ExtendedMusicVideoGeneration[];
  approvals: ExtendedMusicVideoApproval[];
  renders: MusicVideoRender[];
  workerJobs: MusicVideoWorkerJob[];
  assets: MediaAsset[];
  services: VideoServiceReadiness;
  contextSignals: {
    hasAudio: boolean;
    hasArtwork: boolean;
    hasReleaseIdentity: boolean;
  };
};
