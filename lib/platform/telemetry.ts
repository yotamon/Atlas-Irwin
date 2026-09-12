import { assertPathFreePortableValue } from "./recordings";
import type { ExecutionTarget } from "./runtime";

export const COST_TELEMETRY_VERSION = "ensemblis.cost-telemetry.v1" as const;

export type ExecutionCostTelemetry = {
  version: typeof COST_TELEMETRY_VERSION;
  taskId: string;
  processorId: string;
  processorVersion: string;
  target: ExecutionTarget;
  startedAt: string;
  durationMs: number;
  queueMs?: number | null;
  inputBytes: number;
  outputBytes: number;
  cpuMs?: number | null;
  gpuMs?: number | null;
  hardwareClass?: string | null;
  provider?: string | null;
  estimatedCostMicrounits?: number | null;
  currency?: string | null;
};

export function sanitizeExecutionTelemetry(input: ExecutionCostTelemetry): ExecutionCostTelemetry {
  const telemetry = { ...input };
  assertPathFreePortableValue(telemetry, "telemetry");
  for (const [field, value] of Object.entries({
    durationMs: telemetry.durationMs,
    inputBytes: telemetry.inputBytes,
    outputBytes: telemetry.outputBytes,
  })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative finite number.`);
  }
  return telemetry;
}
