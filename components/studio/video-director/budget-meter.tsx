import { availableBudget } from "@/lib/video-director/domain";
import type { MusicVideoProject } from "@/types/database";

function credits(value: number) {
  return Number(value).toLocaleString("en", { maximumFractionDigits: 2 });
}

export function BudgetMeter({
  project,
}: {
  project: Pick<MusicVideoProject, "hard_budget_credits" | "spent_credits" | "reserved_credits">;
}) {
  const hard = Number(project.hard_budget_credits);
  const spent = Number(project.spent_credits);
  const reserved = Number(project.reserved_credits);
  const used = spent + reserved;
  const percentage = hard > 0 ? Math.min(100, (used / hard) * 100) : 0;

  return (
    <div className="video-budget-meter">
      <div className="video-budget-head">
        <span>Generation budget</span>
        <strong>{credits(availableBudget(project))} available</strong>
      </div>
      <div className="progress" aria-label={`${percentage.toFixed(0)}% of budget allocated`}>
        <span style={{ width: `${percentage}%` }} />
      </div>
      <div className="video-budget-stats">
        <span><strong>{credits(spent)}</strong><small>Spent</small></span>
        <span><strong>{credits(reserved)}</strong><small>Reserved</small></span>
        <span><strong>{credits(hard)}</strong><small>Hard limit</small></span>
      </div>
    </div>
  );
}
