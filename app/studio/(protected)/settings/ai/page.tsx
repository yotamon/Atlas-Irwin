import Link from "next/link";
import { applyZeroCostPreset, saveAiControlSettings } from "@/app/studio/ai-control-actions";
import { Field, PageHeader, Panel, Status, Submit } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { isZeroCostPolicy } from "@/lib/ai/control-plane";
import { atlasAiGatewayConfigured } from "@/lib/ai/gateway";
import { getAiControlSummary } from "@/lib/ai/analytics";

function money(value: number) {
  if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function percent(value: number | null) {
  return value === null ? "No data" : `${Math.round(value * 1000) / 10}%`;
}

function latency(value: number | null) {
  if (value === null) return "No data";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function shortModel(model: string) {
  return model.length > 38 ? `${model.slice(0, 35)}…` : model;
}

export default async function AiControlCenterPage() {
  const { user } = await requireStudioAdmin();
  const summary = await getAiControlSummary(user.id);
  const { settings, budget, stats } = summary;
  const budgetPercent = budget.monthlyBudgetUsd > 0 ? Math.min(1, budget.totalSpentUsd / budget.monthlyBudgetUsd) : 1;
  const zeroCost = isZeroCostPolicy(settings);

  return (
    <>
      <PageHeader
        title="AI & Generation"
        description="Atlas chooses models by task, measures quality and cost, escalates only when necessary, and learns from the choices you make in Studio."
        action={<Link className="button" href="/studio/settings">Back to settings</Link>}
      />

      <div className="studio-grid">
        <Panel title="Spend mode">{zeroCost ? "Zero Cost" : "Custom budget"}</Panel>
        <Panel title="Control Plane">{atlasAiGatewayConfigured() ? "Healthy" : "Not configured"}</Panel>
        <Panel title="Month spend">{money(budget.totalSpentUsd)}</Panel>
        <Panel title="AI requests">{stats.requests.toLocaleString()}</Panel>
        <Panel title="Cache reuses">{stats.cacheReuses.toLocaleString()}</Panel>
        <Panel title="First-pass quality">{percent(stats.firstPassSuccessRate)}</Panel>
      </div>

      <section className="studio-panel feature">
        <div className="panel-head">
          <div><span className="section-label">Zero Cost mode</span><h2>{zeroCost ? "Paid media is locked" : "One click back to $0 media spend"}</h2></div>
          <Status>{zeroCost ? "active" : "custom"}</Status>
        </div>
        <p><small>Zero Cost keeps routing on cost-first Auto, caps text/reasoning at $2.25, and sets paid image and video budgets to $0. Provider submission is blocked server-side until you deliberately raise the relevant media budget.</small></p>
        <form action={applyZeroCostPreset}>
          <Submit>{zeroCost ? "Re-apply Zero Cost" : "Enable Zero Cost"}</Submit>
        </form>
      </section>

      <section className="studio-panel feature">
        <div className="panel-head">
          <div><span className="section-label">Budget guardrail</span><h2>{money(budget.totalSpentUsd)} of {money(budget.monthlyBudgetUsd)}</h2></div>
          <Status>{Math.round(budgetPercent * 100)}% used</Status>
        </div>
        <div className="ai-budget-track" aria-label={`${Math.round(budgetPercent * 100)} percent of monthly AI budget used`}>
          <span style={{ width: `${Math.round(budgetPercent * 100)}%` }} />
        </div>
        <p><small>Text/reasoning: {money(budget.textSpentUsd)} of {money(budget.textBudgetUsd)}. Under hard-stop, image/video limits are enforced before specialist provider submission in addition to each Video Director project&apos;s quote, approval and credit envelope.</small></p>
      </section>

      <section className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Reliability + quality</span><h2>What happened after routing</h2></div></div>
        <div className="studio-grid">
          <Panel title="Request success">{percent(stats.successRate)}</Panel>
          <Panel title="Quality gate pass">{percent(stats.qualityPassRate)}</Panel>
          <Panel title="Semantic escalations">{stats.semanticEscalations.toLocaleString()}</Panel>
          <Panel title="Provider fallbacks">{stats.technicalFallbacks.toLocaleString()}</Panel>
          <Panel title="Adaptive routes">{stats.adaptiveRoutes.toLocaleString()}</Panel>
          <Panel title="Avg latency">{latency(stats.averageLatencyMs)}</Panel>
          <Panel title="Human quality signal">{percent(stats.humanQualityScore)}</Panel>
        </div>
        <p><small>{stats.totalInputTokens.toLocaleString()} input tokens · {stats.totalOutputTokens.toLocaleString()} output tokens this month.</small></p>
      </section>

      <section className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Learning signals</span><h2>How generated work was treated</h2></div></div>
        <div className="studio-grid">
          <Panel title="Accepted">{stats.feedbackCounts.accepted.toLocaleString()}</Panel>
          <Panel title="Edited">{stats.feedbackCounts.edited.toLocaleString()}</Panel>
          <Panel title="Rejected">{stats.feedbackCounts.rejected.toLocaleString()}</Panel>
          <Panel title="Regenerated">{stats.feedbackCounts.regenerated.toLocaleString()}</Panel>
          <Panel title="Published">{stats.feedbackCounts.published.toLocaleString()}</Panel>
          <Panel title="Performance samples">{stats.feedbackCounts.performance.toLocaleString()}</Panel>
        </div>
        <p><small>These signals are captured from Studio data changes, not from self-grading by the model. Atlas can therefore compare model cost against actual acceptance, editing, regeneration and downstream performance.</small></p>
      </section>

      <section className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Task intelligence</span><h2>Cost and quality by job</h2></div></div>
        {summary.tasks.length ? (
          <table className="studio-table">
            <thead><tr><th>Task</th><th>Requests</th><th>Cost</th><th>Success</th><th>AI gate</th><th>Human signal</th><th>Escalations</th></tr></thead>
            <tbody>{summary.tasks.map((task) => (
              <tr key={task.task}>
                <td><strong>{task.task}</strong></td>
                <td>{task.requests}</td>
                <td>{money(task.costUsd)}</td>
                <td>{percent(task.successRate)}</td>
                <td>{percent(task.averageQuality)}</td>
                <td>{percent(task.humanQuality)}</td>
                <td>{task.escalations}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="v2-calm-state compact"><strong>No AI runs yet.</strong><p>The first Control Plane generation will appear here automatically.</p></div>}
      </section>

      <section className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Model economics</span><h2>What Atlas actually used</h2></div></div>
        {summary.models.length ? (
          <table className="studio-table">
            <thead><tr><th>Resolved model</th><th>Requests</th><th>Cost</th><th>Failures</th></tr></thead>
            <tbody>{summary.models.map((model) => <tr key={model.model}>
              <td><strong>{model.model}</strong></td><td>{model.requests}</td><td>{money(model.costUsd)}</td><td>{model.failures}</td>
            </tr>)}</tbody>
          </table>
        ) : <p><small>No model usage has been recorded this month.</small></p>}
      </section>

      <section className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Routing policy</span><h2>Task registry</h2></div><Status>{settings.routing_mode}</Status></div>
        <table className="studio-table">
          <thead><tr><th>Task</th><th>Tier</th><th>Configured route</th><th>Semantic escalation</th></tr></thead>
          <tbody>{summary.registry.map((policy) => <tr key={policy.task}>
            <td><strong>{policy.label}</strong><br /><small>{policy.task}</small></td>
            <td>{policy.tier}</td>
            <td>{policy.models.map(shortModel).join(" → ")}</td>
            <td>{policy.escalationModels.length ? policy.escalationModels.map(shortModel).join(" → ") : "None"}</td>
          </tr>)}</tbody>
        </table>
      </section>

      <section className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Adaptive learning</span><h2>Evidence-gated effective routes</h2></div><Status>{stats.adaptiveRoutes} active</Status></div>
        <p><small>Atlas may reorder only models already approved for that task. It requires enough completed runs, deterministic quality and human feedback first. Forced Economy, Balanced or Premium modes always disable learned reordering.</small></p>
        <table className="studio-table">
          <thead><tr><th>Task</th><th>State</th><th>Effective route</th><th>Evidence decision</th></tr></thead>
          <tbody>{summary.learning.map((decision) => <tr key={decision.task}>
            <td><strong>{decision.label}</strong><br /><small>{decision.task}</small></td>
            <td><Status>{decision.applied ? "learned" : "configured"}</Status></td>
            <td>{decision.route.map(shortModel).join(" → ")}</td>
            <td><small>{decision.reason}</small></td>
          </tr>)}</tbody>
        </table>
      </section>

      <section className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Controls</span><h2>Routing and budget policy</h2></div></div>
        <form action={saveAiControlSettings} className="studio-form">
          <div className="form-grid">
            <Field label="Routing mode">
              <select name="routing_mode" defaultValue={settings.routing_mode}>
                <option value="auto">Auto by task</option>
                <option value="economy">Force economy</option>
                <option value="balanced">Force balanced</option>
                <option value="premium">Force premium</option>
              </select>
            </Field>
            <Field label="Provider priority">
              <select name="provider_sort" defaultValue={settings.provider_sort}>
                <option value="cost">Lowest cost</option>
                <option value="ttft">Fastest first token</option>
                <option value="tps">Highest throughput</option>
              </select>
            </Field>
            <Field label="Monthly AI budget ($)"><input type="number" min="0" step="0.01" name="monthly_budget_usd" defaultValue={Number(settings.monthly_budget_usd)} required /></Field>
            <Field label="Text / reasoning ($)"><input type="number" min="0" step="0.01" name="text_budget_usd" defaultValue={Number(settings.text_budget_usd)} required /></Field>
            <Field label="Image hard cap ($)"><input type="number" min="0" step="0.01" name="image_budget_usd" defaultValue={Number(settings.image_budget_usd)} required /></Field>
            <Field label="Video hard cap ($)"><input type="number" min="0" step="0.01" name="video_budget_usd" defaultValue={Number(settings.video_budget_usd)} required /></Field>
            <Field label="Budget enforcement" wide>
              <label className="studio-checkbox"><input type="checkbox" name="hard_stop" defaultChecked={settings.hard_stop} /> Block new text and paid media submissions when their configured budgets would be exceeded</label>
            </Field>
            <Field label="Quality escalation" wide>
              <label className="studio-checkbox"><input type="checkbox" name="quality_escalation" defaultChecked={settings.quality_escalation} /> Escalate GLM → Luna → Sol only after deterministic quality gates require it</label>
            </Field>
          </div>
          <Submit>Save AI policy</Submit>
        </form>
      </section>

      <section className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Trace</span><h2>Recent AI attempts</h2></div></div>
        {summary.recentRuns.length ? (
          <table className="studio-table">
            <thead><tr><th>When</th><th>Task</th><th>Model</th><th>Status</th><th>Quality</th><th>Cost</th><th>Latency</th></tr></thead>
            <tbody>{summary.recentRuns.map((run) => <tr key={run.id}>
              <td>{new Date(run.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" })}</td>
              <td><strong>{run.task_type || run.purpose}</strong>{run.parent_run_id ? <><br /><small>semantic escalation</small></> : null}</td>
              <td>{shortModel(run.model)}</td>
              <td><Status>{run.status}</Status></td>
              <td>{run.quality_score === null ? "-" : percent(Number(run.quality_score))}</td>
              <td>{money(Number(run.actual_cost_usd ?? run.estimated_cost_usd ?? 0))}</td>
              <td>{latency(run.latency_ms)}</td>
            </tr>)}</tbody>
          </table>
        ) : <p><small>No attempts recorded yet.</small></p>}
      </section>
    </>
  );
}
