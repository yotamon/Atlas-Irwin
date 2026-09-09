import { NextResponse } from "next/server";
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
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(error: unknown) {
  if (error instanceof DeviceRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Could not process Library Bridge device jobs." }, { status: 500 });
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
    requireBodyWithin(request, 128 * 1024);
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
      if (jsonByteLength(result) > 64 * 1024) throw new DeviceRequestError("Device job result is too large.");
    }
    const errorMessage = status === "failed"
      ? boundedString(body.error, 500, "error") || "Local device job failed."
      : null;

    const { data: existing, error: readError } = await client
      .from("dj_library_device_jobs")
      .select("id,status")
      .eq("id", jobId)
      .eq("device_id", device.id)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) return NextResponse.json({ error: "Device job was not found." }, { status: 404 });
    if (existing.status === "cancelled") {
      return NextResponse.json({ error: "Device job has been cancelled." }, { status: 409 });
    }
    if (existing.status === "completed" || existing.status === "failed") {
      return NextResponse.json({ accepted: true, idempotent: true, jobId });
    }

    const now = new Date().toISOString();
    const { error: updateError } = await client
      .from("dj_library_device_jobs")
      .update({
        status,
        result: result as Json | null,
        error: errorMessage,
        completed_at: now,
      })
      .eq("id", jobId)
      .eq("device_id", device.id)
      .in("status", ["queued", "claimed"]);
    if (updateError) throw updateError;

    return NextResponse.json({ accepted: true, jobId });
  } catch (error) {
    return failure(error);
  }
}
