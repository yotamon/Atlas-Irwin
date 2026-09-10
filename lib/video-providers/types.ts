import type { VideoAspectRatio, VideoResolution } from "@/lib/video-director/domain";

export type VideoProviderMediaRole =
  | "image"
  | "start_image"
  | "end_image"
  | "video_reference"
  | "audio_reference";

export type VideoProviderMedia = {
  role: VideoProviderMediaRole;
  url: string;
};

export type GenerationOperation = "look_image" | "test_video" | "shot_video" | "reframe";

export type VideoGenerationRequest = {
  operation: GenerationOperation;
  model: string;
  prompt: string;
  negativePrompt?: string | null;
  durationSeconds?: number;
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  medias?: VideoProviderMedia[];
  params?: Record<string, unknown>;
};

export type GenerationQuote = {
  credits: number;
  reserveCredits: number;
  exact: boolean;
  source: "provider" | "static_anchor" | "configured";
  note?: string;
};

export type ProviderSubmission = {
  requestId: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw";
  resultUrl?: string;
  raw: Record<string, unknown>;
};

export type ProviderStatus = ProviderSubmission;

export interface VideoGenerationProvider {
  quote(request: VideoGenerationRequest): Promise<GenerationQuote>;
  submit(request: VideoGenerationRequest, webhookUrl?: string): Promise<ProviderSubmission>;
  status(requestId: string): Promise<ProviderStatus>;
}
