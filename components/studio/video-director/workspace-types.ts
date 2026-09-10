import type { CreativeMemoryRecommendation } from "@/lib/creative-memory/server";
import type { VideoProductionProfilePreview } from "@/lib/video-director/production-profile";
import type { MediaAsset, MusicVideoConcept, MusicVideoRender, MusicVideoScene, Release, Track } from "@/types/database";
import type {
  ExtendedMusicVideoApproval,
  ExtendedMusicVideoGeneration,
  ExtendedMusicVideoProject,
  ExtendedMusicVideoShot,
  MusicVideoCharacter,
  MusicVideoWorkerJob,
} from "@/types/video-database";

export type VideoServiceReadiness = {
  director: { configured: boolean; model: string };
  higgsfield: {
    hasCredentials: boolean;
    configuredModels: string[];
    inferredEndpointsEnabled: boolean;
    hasConfiguredRates: boolean;
    usdPerCredit: number | null;
  };
  worker: { configured: boolean; url: string | null };
};

export type VideoLyricCue = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  sectionId: string;
  allowMedia: boolean;
};

export type VideoStemLane = {
  id: string;
  category: string;
  label: string;
  status: string;
  durationMs: number | null;
  analysis: unknown;
};

export type VideoAudioScene = {
  id: string;
  name: string;
  sceneType: string;
  description: string | null;
  startMs: number | null;
  endMs: number | null;
  score: number | null;
};

export type VideoWorkspaceData = {
  project: ExtendedMusicVideoProject;
  release: Release;
  track: Track;
  audioUrl: string | null;
  concepts: MusicVideoConcept[];
  scenes: MusicVideoScene[];
  shots: ExtendedMusicVideoShot[];
  characters: MusicVideoCharacter[];
  lyricCues: VideoLyricCue[];
  stems: VideoStemLane[];
  audioScenes: VideoAudioScene[];
  generations: ExtendedMusicVideoGeneration[];
  approvals: ExtendedMusicVideoApproval[];
  renders: MusicVideoRender[];
  workerJobs: MusicVideoWorkerJob[];
  assets: MediaAsset[];
  productionProfilePreviews: VideoProductionProfilePreview[];
  creativeMemory: {
    summary: string;
    evidenceCount: number;
    recommendations: CreativeMemoryRecommendation[];
  };
  services: VideoServiceReadiness;
  contextSignals: {
    hasAudio: boolean;
    hasArtwork: boolean;
    hasReleaseIdentity: boolean;
  };
};
