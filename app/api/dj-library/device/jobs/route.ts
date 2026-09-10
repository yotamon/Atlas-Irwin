import { NextResponse } from "next/server";
import { asAutoMixClient } from "@/lib/automix/jobs";
import {
  feedbackSignalFromPlan,
  recordDjPreferenceEvidence,
} from "@/lib/automix/personalization";
import {
  DEVICE_JOB_VERSION,
  DeviceRequestError,
  assertPathFree,
  authenticateLibraryDevice,
  boundedString,
  jsonByteLength,
  record,
  requireBodyWithin,
} from "@/lib/dj-library/device-server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/i;
const RENDER_JOB_VERSION = "ensemblis.library-bridge.render-job.v1";
const RENDER_RESULT_VERSION = "ensemblis.library-bridge.renderer.v1";

function failure(error: unknown) {
  if (error instanceof DeviceRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Could not process Library Bridge device jobs." }, { status: 500 });
}

function sanitizeRenderResult(value: unknown, payload: Record<string, unknown>) {
  const result = record(value);
  if (result.version !== RENDER_RESULT_VERSION || result.status !== "completed") {
    throw new DeviceRequestError("Local render result contract is invalid.");
  }
  const planHash = typeof result.planHash === "string" ? result.planHash : "";
  const expectedPlanHash = typeof payload.planHash === "string" ? payload.planHash : "";
  const sha256 = typeof result.sha256 === "string" ? result.sha256 : "";
  const outputFormat = result.outputFormat;
  const fileSize = result.fileSize;
  if (!expectedPlanHash || planHash !== expectedPlanHash) {
    throw new DeviceRequestError("Local render result does not match the approved MixPlan.");
  }
  if (!SHA256_RE.test(sha256)) throw new DeviceRequestError("Local render output identity is invalid.");
  if (outputFormat !== "wav" && outputFormat !== "mp3") {
    throw new DeviceRequestError("Local render output format is invalid.");
  }
  if (typeof fileSize !== "number" || !Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > 20 * 1024 * 1024 * 1024) {
    throw new DeviceRequestError("Local render output size is invalid.");
  }
  const render = record(result.render);
  assertPathFree(render, "render metrics");
  return {
    version: RENDER_RESULT_VERSION,
    status: "completed",
    planHash,
    outputFormat,
    mimeType: outputFormat === "wav" ? "audio/wav" : "audio/mpeg",
    sha256,
    fileSize,
    render,
  };
}

async function finalizeAutoMixRender({
  automixJobId,
  deviceJobStatus,
  deviceJobPayload,
  result,
  errorMessage,
}: {
  automixJobId: string;
  deviceJobStatus: "completed" | "failed";
  deviceJobPayload: Record<string, unknown>;
  result: unknown;
  errorMessage: string | null;
}) {
  const service = createServiceClient();
  const db = asAutoMixClient(service);
  const existing = await db.from("automix_jobs").select("*").eq("id", automixJobId).maybeSingle();
  if (existing.error || !existing.data) throw new Error(existing.error?.message || "AutoMix render lineage was not found.");
  const job = existing.data;
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return { terminal: false, learningRecorded: false };
  }

  const mixPlan = record(deviceJobPayload.mixPlan);
  const publicResult = deviceJobStatus === "completed"
    ? sanitizeRenderResult(result, deviceJobPayload)
    : null;
  const resultPayload = deviceJobStatus === "completed"
    ? {
        phase: "complete",
        uploaded: false,
        execution_target: "device",
        plan: { ...mixPlan, render_manifest: mixPlan, approved_for_render: true },
        render_manifest: mixPlan,
        render: publicResult?.render ?? {},
        device_render: publicResult,
        output: publicResult ? {
          file_size: publicResult.fileSize,
          mime_type: publicResult.mimeType,
          sha256: publicResult.sha256,
          storage: "device-local",
        } : null,
      }
    : {
        phase: "failed",
        uploaded: false,
        execution_target: "device",
        plan: { ...mixPlan, render_manifest: mixPlan, approved_for_render: true },
        render_manifest: mixPlan,
      };
  assertPathFree(resultPayload, "AutoMix device result");

  const update = await db.from("automix_jobs").update({
    status: deviceJobStatus,
    result_payload: resultPayload as Json,
    output_asset_id: null,
    error: deviceJobStatus === "failed" ? errorMessage || "Local MixPlan render failed." : null,
    completed_at: new Date().toISOString(),
  }).eq("id", automixJobId)
    .in("status", ["planned", "queued", "running"])
    .select("id")
    .maybeSingle();
  if (update.error) throw new Error(update.error.message);
  if (!update.data || deviceJobStatus !== "completed") {
    return { terminal: Boolean(update.data), learningRecorded: false };
  }

  let learningRecorded = false;
  try {
    await recordDjPreferenceEvidence({
      client: service,
      ownerId: job.owner_id,
      artistId: job.artist_id,
      jobId: job.id,
      evidenceType: "plan_approval",
      evidenceKey: "approved_mixplan",
      signal: feedbackSignalFromPlan(record(resultPayload.plan)),
      weight: 1,
    });
    learningRecorded = true;
  } catch {
    // Rendering is canonical and terminal even if optional preference aggregation is unavailable.
    learningRecorded = false;
  }
  return { terminal: true, learningRecorded };
}

export async function GET(request: Request) {
  try {
    const { client, device } = await authenticateLibraryDevice(request);
    const { data, error } = await client.rpc("claim_dj_library_device_jobs", {
      p_device_id: device.id,
      p_limit: 8,
    });
    if (error) throw error;
    return NextResponse.json({
      jobs: (data ?? []).map((job) => ({
        version: DEVICE_JOB_VERSION,
        id: job.id,
        idempotencyKey: job.idempotency_key,
        jobType: job.job_type,
        sourceRevision: job.source_revision,
        payload: job.payload,
      })),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    requireBodyWithin(request, 256 * 1024);
    const { client, device } = await authenticateLibraryDevice(request);
    const body = record(await request.json().catch(() => null));
    const jobId = boundedString(body.jobId, 64, "jobId", { required: true });
    if (!UUID_RE.test(jobId)) throw new DeviceRequestError("jobId is invalid.");
    const status = boundedString(body.status, 16, "status", { required: true });
    if (status !== "completed" && status !== "failed") {
      throw new DeviceRequestError("Device job result status is invalid.");
    }

    const result = body.result === undefined ? null : body.result;
    if (result !== null) {
      assertPathFree(result, "job result");
      if (jsonByteLength(result) > 192 * 1024) throw new DeviceRequestError("Device job result is too large.");
    }
    const errorMessage = status === "failed"
      ? boundedString(body.error, 500, "error") || "Local device job failed."
      : null;

    const { data: existing, error: readError } = await client
      .from("dj_library_device_jobs")
      .select("id,status,job_type,automix_job_id,payload")
      .eq("id", jobId)
      .eq("device_id", device.id)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) return NextResponse.json({ error: "Device job was not found." }, { status: 404 });
    if (existing.status === "cancelled") {
      return NextResponse.json({ error: "Device job has been cancelled." }, { status: 409 });
    }

    const devicePayload = record(existing.payload);
    if (existing.job_type === "render_mixplan" && devicePayload.version !== RENDER_JOB_VERSION) {
      throw new DeviceRequestError("Unsupported local MixPlan render job contract.");
    }
    if (existing.job_type === "render_mixplan" && status === "completed") {
      sanitizeRenderResult(result, devicePayload);
    }

    if (existing.status === "completed" || existing.status === "failed") {
      if (existing.job_type === "render_mixplan" && existing.automix_job_id) {
        await finalizeAutoMixRender({
          automixJobId: existing.automix_job_id,
          deviceJobStatus: existing.status,
          deviceJobPayload: devicePayload,
          result,
          errorMessage,
        });
      }
      return NextResponse.json({ accepted: true, idempotent: true, jobId });
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await client
      .from("dj_library_device_jobs")
      .update({
        status,
        result: result as Json | null,
        error: errorMessage,
        completed_at: now,
      })
      .eq("id", jobId)
      .eq("device_id", device.id)
      .in("status", ["queued", "claimed"])
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;

    let automixTerminal = false;
    let learningRecorded = false;
    if (updated && existing.job_type === "render_mixplan" && existing.automix_job_id) {
      const finalized = await finalizeAutoMixRender({
        automixJobId: existing.automix_job_id,
        deviceJobStatus: status,
        deviceJobPayload: devicePayload,
        result,
        errorMessage,
      });
      automixTerminal = finalized.terminal;
      learningRecorded = finalized.learningRecorded;
    }

    return NextResponse.json({ accepted: true, jobId, automixTerminal, learningRecorded });
  } catch (error) {
    return failure(error);
  }
}
