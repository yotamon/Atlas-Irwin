import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_WORKER_PROCESSOR_BY_JOB, processorDescriptor } from "@/lib/platform/processors";
import {
  COST_TELEMETRY_VERSION,
  sanitizeExecutionTelemetry,
} from "@/lib/platform/telemetry";
import { createServiceClient } from "@/lib/supabase/service";
import type { LicensingDatabase } from "@/types/licensing-database";

function finiteNonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function timestamp(value: string | null | undefined, fallback: number) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function processorFor(jobType: string) {
  const processorId = (MEDIA_WORKER_PROCESSOR_BY_JOB as Record<string, string>)[jobType];
  if (!processorId) return null;
  const descriptor = processorDescriptor(processorId);
  return descriptor ? { processorId, descriptor } : null;
}

export async function recordMediaWorkerExecutionTelemetry(input: {
  ownerId: string | null;
  taskId: string;
  jobType: string;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  requestPayload?: unknown;
  resultPayload?: unknown;
}) {
  const processor = processorFor(input.jobType);
  if (!processor || !input.taskId.trim()) return;

  const completedMs = timestamp(input.completedAt, Date.now());
  const startedMs = timestamp(input.startedAt, completedMs);
  const createdMs = timestamp(input.createdAt, startedMs);
  const result = object(input.resultPayload);
  const requestPayload = object(input.requestPayload);
  const inputBytes = finiteNonNegative(requestPayload.input_bytes)
    ?? finiteNonNegative(requestPayload.source_file_size)
    ?? 0;
  const outputBytes = finiteNonNegative(result.output_bytes)
    ?? finiteNonNegative(result.file_size)
    ?? 0;
  const cpuMs = finiteNonNegative(result.cpu_ms);
  const gpuMs = finiteNonNegative(result.gpu_ms);
  const estimatedCostMicrounits = finiteNonNegative(result.estimated_cost_microunits);
  const currency = typeof result.currency === "string" && /^[A-Z]{3}$/.test(result.currency)
    ? result.currency
    : null;
  const hardwareClass = typeof result.hardware_class === "string" && result.hardware_class.length <= 120
    ? result.hardware_class
    : null;

  const telemetry = sanitizeExecutionTelemetry({
    version: COST_TELEMETRY_VERSION,
    taskId: input.taskId,
    processorId: processor.processorId,
    processorVersion: processor.descriptor.processorVersion,
    target: "cloud",
    startedAt: new Date(startedMs).toISOString(),
    durationMs: Math.max(0, completedMs - startedMs),
    queueMs: Math.max(0, startedMs - createdMs),
    inputBytes,
    outputBytes,
    cpuMs,
    gpuMs,
    hardwareClass,
    provider: "vercel_sandbox",
    estimatedCostMicrounits,
    currency,
  });

  const db = createServiceClient() as unknown as SupabaseClient<LicensingDatabase>;
  const { error } = await db.from("ensemblis_execution_telemetry").upsert({
    owner_id: input.ownerId,
    task_id: telemetry.taskId,
    processor_id: telemetry.processorId,
    processor_version: telemetry.processorVersion,
    target: telemetry.target,
    started_at: telemetry.startedAt,
    duration_ms: telemetry.durationMs,
    queue_ms: telemetry.queueMs ?? null,
    input_bytes: telemetry.inputBytes,
    output_bytes: telemetry.outputBytes,
    cpu_ms: telemetry.cpuMs ?? null,
    gpu_ms: telemetry.gpuMs ?? null,
    hardware_class: telemetry.hardwareClass ?? null,
    provider: telemetry.provider ?? null,
    estimated_cost_microunits: telemetry.estimatedCostMicrounits ?? null,
    currency: telemetry.currency ?? null,
  }, { onConflict: "task_id,processor_id,target" });
  if (error) throw new Error(error.message);
}
