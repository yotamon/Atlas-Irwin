import { RUNTIME_TASK_VERSION, type ExecutionPolicy, type RuntimeTask } from "./runtime";

export function createRuntimeTask(input: {
  id: string;
  idempotencyKey: string;
  processorId: string;
  processorVersion: string;
  inputReferences?: RuntimeTask["inputReferences"];
  payload?: Record<string, unknown>;
  policy: ExecutionPolicy;
  requestedTarget?: RuntimeTask["execution"]["requestedTarget"];
  context?: Record<string, unknown>;
}): RuntimeTask {
  if (!input.id.trim() || !input.idempotencyKey.trim()) throw new Error("Runtime tasks require stable id and idempotency key.");
  if (!input.processorId.trim() || !input.processorVersion.trim()) throw new Error("Runtime tasks require a processor identity.");
  return {
    version: RUNTIME_TASK_VERSION,
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    processor: { id: input.processorId, version: input.processorVersion },
    inputReferences: input.inputReferences ?? [],
    payload: input.payload ?? {},
    execution: { policy: input.policy, requestedTarget: input.requestedTarget ?? "automatic" },
    context: input.context,
  };
}
