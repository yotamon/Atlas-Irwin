export const MARKETING_MAINTENANCE_JOBS = [
  { jobType: "maintenance:state_reconciliation", cadenceMs: 15 * 60 * 1000 },
  { jobType: "maintenance:publications", cadenceMs: 15 * 60 * 1000 },
  { jobType: "maintenance:outreach", cadenceMs: 15 * 60 * 1000 },
  { jobType: "maintenance:creative_spend", cadenceMs: 15 * 60 * 1000 },
  { jobType: "maintenance:creative_derivatives", cadenceMs: 15 * 60 * 1000 },
  { jobType: "maintenance:event_automation", cadenceMs: 15 * 60 * 1000 },
  { jobType: "maintenance:audience_sync", cadenceMs: 60 * 60 * 1000 },
  { jobType: "maintenance:radar", cadenceMs: 6 * 60 * 60 * 1000 },
  { jobType: "maintenance:next_best_actions", cadenceMs: 60 * 60 * 1000 },
  { jobType: "maintenance:manager_execution", cadenceMs: 60 * 60 * 1000 },
] as const;

export type MarketingMaintenanceJobType = (typeof MARKETING_MAINTENANCE_JOBS)[number]["jobType"];

const cadenceByType = new Map<string, number>(
  MARKETING_MAINTENANCE_JOBS.map((item) => [item.jobType, item.cadenceMs]),
);

export function marketingMaintenanceCadenceMs(jobType: string) {
  return cadenceByType.get(jobType) ?? null;
}

export function isMarketingMaintenanceJob(jobType: string): jobType is MarketingMaintenanceJobType {
  return cadenceByType.has(jobType);
}
