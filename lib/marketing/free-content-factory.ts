import "server-only";

import { createHash } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { createMarketingServiceClient } from "./db";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";

const SANDBOX_NAME = "atlas-free-content-factory";
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_SECONDS = 15;
const BUCKET = "public-media";

const TEMPLATES = [
  "deep_zoom",
  "slow_drift",
  "glass_echo",
  "mono_pulse",
  "warm_bloom",
  "club_flash",
  "soft_focus",
  "minimal_frame",
] as const;

type Template = (typeof TEMPLATES)[number];

function asJson(value: unknown) {
  return value as Json;
}

function sandboxAvailable() {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_TOKEN?.trim());
}

function templateFor(seed: string): Template {
  const byte = createHash("sha256").update(seed).digest()[0];
  return TEMPLATES[byte % TEMPLATES.length];
}

function filterFor(template: Template) {
  const base = "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:2[bg];[0:v]scale=900:900:force_original_aspect_ratio=decrease[cover]";
  if (template === "deep_zoom") return `${base};[bg][cover]overlay=(W-w)/2:(H-h)/2,zoompan=z='min(zoom+0.0007,1.08)':d=1:s=1080x1920:fps=30,format=yuv420p[v]`;
  if (template === "slow_drift") return `${base};[bg][cover]overlay='(W-w)/2+18*sin(t/2.5)':'(H-h)/2+12*cos(t/3)',eq=saturation=1.08:contrast=1.03,format=yuv420p[v]`;
  if (template === "glass_echo") return `${base};[bg]eq=saturation=1.25:contrast=1.04[bg2];[cover]split=2[c1][c2];[c2]scale=940:940,boxblur=18:3,colorchannelmixer=aa=0.28[echo];[bg2][echo]overlay=(W-w)/2:(H-h)/2[stage];[stage][c1]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`;
  if (template === "mono_pulse") return `${base};[cover]eq=saturation=0.15:contrast=1.16[mono];[bg][mono]overlay=(W-w)/2:(H-h)/2,eq=brightness='0.02*sin(2*PI*t/2)':eval=frame,format=yuv420p[v]`;
  if (template === "warm_bloom") return `${base};[bg]colorbalance=rs=.08:gs=.02:bs=-.04[bg2];[cover]eq=saturation=1.12:brightness=0.02[art];[bg2][art]overlay=(W-w)/2:(H-h)/2,vignette=PI/5,format=yuv420p[v]`;
  if (template === "club_flash") return `${base};[bg][cover]overlay=(W-w)/2:(H-h)/2,eq=brightness='if(lt(mod(t,2),0.08),0.08,0)':eval=frame:saturation=1.15,format=yuv420p[v]`;
  if (template === "soft_focus") return `${base};[bg]gblur=sigma=18[bg2];[cover]eq=saturation=.92:contrast=.98[art];[bg2][art]overlay=(W-w)/2:(H-h)/2,vignette=PI/4,format=yuv420p[v]`;
  return `${base};[bg][cover]overlay=(W-w)/2:(H-h)/2,drawbox=x=74:y=434:w=932:h=932:color=white@0.16:t=2,format=yuv420p[v]`;
}

async function composerSandbox() {
  if (!sandboxAvailable()) throw new Error("Vercel Sandbox is unavailable outside a Vercel deployment. Atlas did not use a paid fallback.");
  return Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    runtime: "node24",
    resources: { vcpus: 2 },
    timeout: SANDBOX_TIMEOUT_MS,
    persistent: true,
    keepLastSnapshots: { count: 1 },
    tags: { app: "atlas-irwin", role: "free-content-factory" },
    onCreate: async (sandbox) => {
      const setup = await sandbox.runCommand({
        cmd: "bash",
        args: ["-lc", "mkdir -p /workspace && cd /workspace && npm init -y >/dev/null 2>&1 && npm install ffmpeg-static@5.2.0 --omit=dev >/dev/null 2>&1"],
      });
      if (setup.exitCode !== 0) throw new Error(`Could not initialize the free content composer: ${setup.stderr}`);
    },
  });
}

async function ffmpegPath(sandbox: Sandbox) {
  const result = await sandbox.runCommand({
    cmd: "node",
    args: ["-e", "process.stdout.write(require('ffmpeg-static'))"],
    cwd: "/workspace",
  });
  if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error("ffmpeg-static is unavailable in the persistent composer Sandbox.");
  return result.stdout.trim();
}

async function downloadInput(sandbox: Sandbox, url: string, path: string) {
  const result = await sandbox.runCommand({ cmd: "curl", args: ["-L", "--fail", "--silent", "--show-error", "-o", path, url] });
  if (result.exitCode !== 0) throw new Error(`Could not download a source asset for free composition: ${result.stderr}`);
}

async function render({
  artworkUrl,
  audioUrl,
  startSeconds,
  template,
}: {
  artworkUrl: string;
  audioUrl: string;
  startSeconds: number;
  template: Template;
}) {
  const sandbox = await composerSandbox();
  const work = `/tmp/atlas-compose-${crypto.randomUUID()}`;
  try {
    const mkdir = await sandbox.runCommand("mkdir", ["-p", work]);
    if (mkdir.exitCode !== 0) throw new Error(mkdir.stderr || "Could not initialize composition workspace.");
    await Promise.all([
      downloadInput(sandbox, artworkUrl, `${work}/artwork`),
      downloadInput(sandbox, audioUrl, `${work}/audio`),
    ]);
    const ffmpeg = await ffmpegPath(sandbox);
    const command = await sandbox.runCommand({
      cmd: ffmpeg,
      args: [
        "-y",
        "-loop", "1",
        "-framerate", "30",
        "-i", `${work}/artwork`,
        "-ss", startSeconds.toFixed(3),
        "-i", `${work}/audio`,
        "-t", String(OUTPUT_SECONDS),
        "-filter_complex", filterFor(template),
        "-map", "[v]",
        "-map", "1:a:0",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "21",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        `${work}/output.mp4`,
      ],
      cwd: work,
    });
    if (command.exitCode !== 0) throw new Error(`FFmpeg composition failed: ${command.stderr.slice(-1200)}`);
    const result = await sandbox.readFile(`${work}/output.mp4`);
    return Buffer.isBuffer(result) ? result : Buffer.from(result);
  } finally {
    try { await sandbox.runCommand("rm", ["-rf", work]); } catch { /* best effort */ }
    try { await sandbox.stop(); } catch { /* persistent snapshot may already be stopping */ }
  }
}

export async function composeFreeSocialAsset(ownerId: string, contentItemId: string) {
  const marketing = createMarketingServiceClient();
  const db = createServiceClient();
  const { data: item, error: itemError } = await marketing.from("content_items")
    .select("*")
    .eq("id", contentItemId)
    .eq("owner_id", ownerId)
    .single();
  if (itemError || !item) throw new Error(itemError?.message || "Content item not found.");
  if (item.asset_url) return { reused: true as const, assetUrl: item.asset_url };
  if (!item.release_id) throw new Error("Free composition requires content linked to a release.");

  const [releaseResult, trackResult] = await Promise.all([
    db.from("releases").select("id,title,artwork_url").eq("id", item.release_id).eq("owner_id", ownerId).single(),
    db.from("tracks").select("id,title,audio_url,display_order").eq("release_id", item.release_id).eq("owner_id", ownerId).not("audio_url", "is", null).order("display_order", { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (releaseResult.error || !releaseResult.data) throw new Error(releaseResult.error?.message || "Release not found.");
  if (trackResult.error) throw new Error(trackResult.error.message);
  const release = releaseResult.data;
  const track = trackResult.data;
  if (!release.artwork_url) throw new Error("Free composition needs release artwork.");
  if (!track?.audio_url) throw new Error("Free composition needs a release track with a public audio URL.");

  const template = templateFor(`${item.id}:${item.platform}:${item.format}`);
  const startSeconds = Math.max(0, Number(item.audio_timestamp_start) || 0);
  const output = await render({ artworkUrl: release.artwork_url, audioUrl: track.audio_url, startSeconds, template });
  const hash = createHash("sha256").update(output).digest("hex");
  const storagePath = `${ownerId}/generated/free-social/${item.id}/${hash.slice(0, 16)}.mp4`;
  const upload = await db.storage.from(BUCKET).upload(storagePath, output, {
    contentType: "video/mp4",
    upsert: false,
    cacheControl: "31536000",
  });
  if (upload.error && !/already exists/i.test(upload.error.message)) throw new Error(upload.error.message);
  const { data: publicData } = db.storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = publicData.publicUrl;

  const { data: run, error: runError } = await marketing.from("generation_runs").insert({
    owner_id: ownerId,
    campaign_id: item.campaign_id,
    release_id: item.release_id,
    purpose: "content_asset:free_social_video",
    task_type: null,
    provider: "atlas-free-composer",
    model: template,
    requested_model: template,
    prompt_version: "ffmpeg-social-v1",
    input_context: asJson({ contentItemId: item.id, artworkUrl: release.artwork_url, audioUrl: track.audio_url, startSeconds, durationSeconds: OUTPUT_SECONDS }),
    output: asJson({ assetUrl: publicUrl, template, contentHash: hash }),
    status: "completed",
    attempt_index: 0,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    actual_cost_usd: 0,
    estimated_cost_usd: 0,
    quality_gate_passed: true,
    quality_score: 1,
    quality_failures: [],
    metadata: asJson({ freeComposition: true, sandbox: SANDBOX_NAME }),
  }).select("id").single();
  if (runError || !run) throw new Error(runError?.message || "Could not record free composition provenance.");

  const { data: asset, error: assetError } = await db.from("media_assets").insert({
    owner_id: ownerId,
    bucket_name: BUCKET,
    storage_path: storagePath,
    public_url: publicUrl,
    asset_type: "content_video",
    mime_type: "video/mp4",
    file_size: output.length,
    content_hash: hash,
    width: 1080,
    height: 1920,
    duration_ms: OUTPUT_SECONDS * 1000,
    visibility: "public",
    metadata: asJson({ title: `${release.title} social cut`, upload_source: "atlas_free_content_factory", template, generation_run_id: run.id }),
  }).select("id").single();
  if (assetError || !asset) throw new Error(assetError?.message || "Could not save free composition to the Media Library.");

  await db.from("media_links").insert({
    owner_id: ownerId,
    media_asset_id: asset.id,
    release_id: item.release_id,
    content_item_id: item.id,
    role: "content_video",
    display_order: 0,
    is_primary: true,
  });
  const { error: updateError } = await marketing.from("content_items").update({
    asset_url: publicUrl,
    generated_from_run_id: run.id,
  }).eq("id", item.id).eq("owner_id", ownerId);
  if (updateError) throw new Error(updateError.message);

  await marketing.from("marketing_events").insert({
    owner_id: ownerId,
    campaign_id: item.campaign_id,
    event_type: "content.free_asset_ready",
    entity_type: "content_item",
    entity_id: item.id,
    payload: asJson({ mediaAssetId: asset.id, generationRunId: run.id, template, costUsd: 0 }),
  });
  return { reused: false as const, assetUrl: publicUrl, mediaAssetId: asset.id, template };
}

export async function fillOneMissingScheduledAsset() {
  if (!sandboxAvailable()) return { outcome: "sandbox_unavailable" as const };
  const marketing = createMarketingServiceClient();
  const horizon = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const { data, error } = await marketing.from("content_items")
    .select("id,owner_id,release_id,scheduled_at,asset_url,status")
    .is("asset_url", null)
    .not("release_id", "is", null)
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", horizon)
    .not("status", "in", '("Published","Archived")')
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { outcome: "nothing_missing" as const };
  try {
    const result = await composeFreeSocialAsset(data.owner_id, data.id);
    return { outcome: "composed" as const, contentItemId: data.id, ...result };
  } catch (error) {
    return { outcome: "skipped" as const, contentItemId: data.id, reason: error instanceof Error ? error.message : "Free composition failed." };
  }
}