import "server-only";

export type AiQualityResult = {
  passed: boolean;
  score: number;
  failures: string[];
};

export type AiQualityGate<T> = (value: T) => AiQualityResult | Promise<AiQualityResult>;

/** @deprecated Use AiQualityResult. */
export type AtlasQualityResult = AiQualityResult;
/** @deprecated Use AiQualityGate. */
export type AtlasQualityGate<T> = AiQualityGate<T>;

export function qualityResult(checks: Array<{ passed: boolean; failure: string; weight?: number }>, threshold = 0.85): AiQualityResult {
  if (!checks.length) return { passed: true, score: 1, failures: [] };
  const totalWeight = checks.reduce((sum, check) => sum + (check.weight ?? 1), 0);
  const passedWeight = checks.reduce((sum, check) => sum + (check.passed ? (check.weight ?? 1) : 0), 0);
  const score = totalWeight > 0 ? Math.max(0, Math.min(1, passedWeight / totalWeight)) : 1;
  const failures = checks.filter((check) => !check.passed).map((check) => check.failure);
  return { passed: failures.length === 0 || score >= threshold, score, failures };
}

export function strictQualityResult(checks: Array<{ passed: boolean; failure: string; weight?: number }>): AiQualityResult {
  const result = qualityResult(checks, 1);
  return { ...result, passed: result.failures.length === 0 };
}

export function noQualityGate(): AiQualityResult {
  return { passed: true, score: 1, failures: [] };
}
