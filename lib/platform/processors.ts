import type { ProcessorDescriptor } from "./runtime";
import { PROCESSOR_DESCRIPTOR_VERSION } from "./runtime";

function descriptor(value: Omit<ProcessorDescriptor, "version">): ProcessorDescriptor {
  return { version: PROCESSOR_DESCRIPTOR_VERSION, ...value };
}

// This registry deliberately advertises only execution parity that exists today.
// A processor becomes multi-target only after local/cloud output conformance is proven.
export const PROCESSOR_REGISTRY = {
  "dj.track-planning-intelligence": descriptor({
    id: "dj.track-planning-intelligence",
    processorVersion: "ensemblis.library-bridge.analyzer.v1",
    inputKinds: ["recording"],
    outputKinds: ["ensemblis.library-bridge.analysis-payload.v1"],
    targets: { local_sidecar: { supported: true } },
    privacy: { requiresRawAudio: true },
  }),
  "dj.mixplan-render": descriptor({
    id: "dj.mixplan-render",
    processorVersion: "ensemblis.library-bridge.renderer.v1",
    inputKinds: ["project", "recording", "analysis"],
    outputKinds: ["audio.render"],
    targets: { local_sidecar: { supported: true } },
    privacy: { requiresRawAudio: true },
  }),
  "media-worker.analyze-audio": descriptor({
    id: "media-worker.analyze-audio",
    processorVersion: "1",
    inputKinds: ["recording"],
    outputKinds: ["audio.analysis"],
    targets: { cloud: { supported: true, requiresNetwork: true, paidCompute: true, requiredEntitlement: "cloud.compute" } },
    privacy: { requiresRawAudio: true },
  }),
  "media-worker.analyze-stem": descriptor({
    id: "media-worker.analyze-stem",
    processorVersion: "1",
    inputKinds: ["recording"],
    outputKinds: ["audio.stem-analysis"],
    targets: { cloud: { supported: true, requiresNetwork: true, paidCompute: true, requiredEntitlement: "cloud.compute" } },
    privacy: { requiresRawAudio: true },
  }),
  "media-worker.extract-frame": descriptor({
    id: "media-worker.extract-frame",
    processorVersion: "1",
    inputKinds: ["asset"],
    outputKinds: ["image.frame"],
    targets: { cloud: { supported: true, requiresNetwork: true, paidCompute: true, requiredEntitlement: "cloud.compute" } },
    privacy: { requiresRawAudio: false },
  }),
  "media-worker.render-master": descriptor({
    id: "media-worker.render-master",
    processorVersion: "1",
    inputKinds: ["recording", "analysis"],
    outputKinds: ["audio.master"],
    targets: { cloud: { supported: true, requiresNetwork: true, paidCompute: true, requiredEntitlement: "cloud.compute" } },
    privacy: { requiresRawAudio: true },
  }),
  "media-worker.render-social": descriptor({
    id: "media-worker.render-social",
    processorVersion: "1",
    inputKinds: ["recording", "asset", "analysis"],
    outputKinds: ["video.social"],
    targets: { cloud: { supported: true, requiresNetwork: true, paidCompute: true, requiredEntitlement: "cloud.compute" } },
    privacy: { requiresRawAudio: true },
  }),
  "media-worker.render-promo": descriptor({
    id: "media-worker.render-promo",
    processorVersion: "1",
    inputKinds: ["recording", "asset", "analysis"],
    outputKinds: ["video.promo"],
    targets: { cloud: { supported: true, requiresNetwork: true, paidCompute: true, requiredEntitlement: "cloud.compute" } },
    privacy: { requiresRawAudio: true },
  }),
  "media-worker.render-hook": descriptor({
    id: "media-worker.render-hook",
    processorVersion: "1",
    inputKinds: ["recording", "analysis"],
    outputKinds: ["audio.hook"],
    targets: { cloud: { supported: true, requiresNetwork: true, paidCompute: true, requiredEntitlement: "cloud.compute" } },
    privacy: { requiresRawAudio: true },
  }),
  "media-worker.render-audio-scene": descriptor({
    id: "media-worker.render-audio-scene",
    processorVersion: "1",
    inputKinds: ["recording", "analysis"],
    outputKinds: ["audio.scene"],
    targets: { cloud: { supported: true, requiresNetwork: true, paidCompute: true, requiredEntitlement: "cloud.compute" } },
    privacy: { requiresRawAudio: true },
  }),
  "media-worker.master-audio": descriptor({
    id: "media-worker.master-audio",
    processorVersion: "1",
    inputKinds: ["recording", "analysis"],
    outputKinds: ["audio.master"],
    targets: { cloud: { supported: true, requiresNetwork: true, paidCompute: true, requiredEntitlement: "cloud.compute" } },
    privacy: { requiresRawAudio: true },
  }),
  "media-worker.finish-social-video": descriptor({
    id: "media-worker.finish-social-video",
    processorVersion: "1",
    inputKinds: ["asset"],
    outputKinds: ["video.social-finished"],
    targets: { cloud: { supported: true, requiresNetwork: true, paidCompute: true, requiredEntitlement: "cloud.compute" } },
    privacy: { requiresRawAudio: false },
  }),
  "media-worker.render-automix": descriptor({
    id: "media-worker.render-automix",
    processorVersion: "1",
    inputKinds: ["recording", "analysis", "project"],
    outputKinds: ["audio.automix"],
    targets: { cloud: { supported: true, requiresNetwork: true, paidCompute: true, requiredEntitlement: "cloud.compute" } },
    privacy: { requiresRawAudio: true },
  }),
} as const satisfies Record<string, ProcessorDescriptor>;

export type ProcessorId = keyof typeof PROCESSOR_REGISTRY;

export function processorDescriptor(id: string): ProcessorDescriptor | null {
  return (PROCESSOR_REGISTRY as Record<string, ProcessorDescriptor>)[id] ?? null;
}

export const MEDIA_WORKER_PROCESSOR_BY_JOB = {
  analyze_audio: "media-worker.analyze-audio",
  analyze_stem: "media-worker.analyze-stem",
  extract_frame: "media-worker.extract-frame",
  render_master: "media-worker.render-master",
  render_social: "media-worker.render-social",
  render_promo: "media-worker.render-promo",
  render_hook: "media-worker.render-hook",
  render_audio_scene: "media-worker.render-audio-scene",
  master_audio: "media-worker.master-audio",
  finish_social_video: "media-worker.finish-social-video",
  render_automix: "media-worker.render-automix",
} as const;
