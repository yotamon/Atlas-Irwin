import Link from "next/link";
import { developQuickVideoDirection } from "@/app/studio/quick-video-actions";
import { approveVideoProductionPlan } from "@/app/studio/video-pipeline-actions";
import { SubmitButton } from "@/components/studio/submit-button";
import { Status } from "@/components/studio/ui";
import { availableBudget, parseVideoCreativeBrief, type VideoProjectStatus } from "@/lib/video-director/domain";
import { ProjectHeader } from "./project-header";
import { RecoveryPanel } from "./recovery-panel";
import { TrackIntelligenceInspector } from "./track-intelligence-inspector";
import {
  GenerationPanel,
  ShotReviewPanel,
} from "./production-panels";
import { LookDevelopmentPanel } from "./look-development-panel";
import { DeliveryPanel } from "./delivery-panel";
import type { VideoWorkspaceData } from "./workspace-types";

type QuickPhase = "direction" | "preview" | "production" | "delivery" | "attention";

const QUICK_PHASES: Array<{ id: Exclude<QuickPhase, "attention">; label: string; detail: string }> = [
  { id: "direction", label: "Direction", detail: "Music-aware treatment" },
  { id: "preview", label: "Preview", detail: "Representative quality check" },
  { id: "production", label: "Production", detail: "Bounded generation" },
  { id: "delivery", label: "Master + socials", detail: "Review and export" },
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function phaseForStatus(status: VideoProjectStatus): QuickPhase {
  if (["draft", "analyzing_audio", "concept_review", "treatment_review"].includes(status)) return "direction";
  if (["production_plan_review", "look_dev", "look_review", "test_generation", "test_review"].includes(status)) return "preview";
  if (["production", "shot_review"].includes(status)) return "production";
  if (["ready_to_render", "rendering", "complete"].includes(status)) return "delivery";
  return "attention";
}

function phaseState(current: QuickPhase, candidate: Exclude<QuickPhase, "attention">) {
  const order = QUICK_PHASES.map((phase) => phase.id);
  const currentIndex = order.indexOf(current as Exclude<QuickPhase, "attention">);
  const candidateIndex = order.indexOf(candidate);
  if (current === "attention") return "Paused";
  if (candidateIndex < currentIndex) return "Done";
  if (candidateIndex === currentIndex) return "Now";
  return "Next";
}

function credits(value: number) {
  return `${Number(value || 0).toFixed(1)} cr`;
}

function DirectionDevelopment({ data }: { data: VideoWorkspaceData }) {
  const brief = parseVideoCreativeBrief(data.project.creative_brief);
  const selected = data.concepts.find((concept) => concept.id === data.project.selected_concept_id) ?? data.concepts.find((concept) => concept.status === "selected");
  const snapshot = brief.concept_snapshot;
  const developing = data.project.status === "treatment_review";
  return (
    <section className="workspace-section" id="quick-direction">
      <div className="section-head">
        <div><span className="section-label">Approved direction</span><h2>{snapshot?.title ?? selected?.title ?? "Quick Video direction"}</h2></div>
        <Status>{selected ? "Developed" : "Selected"}</Status>
      </div>
      <p className="section-copy">{snapshot?.description ?? selected?.premise ?? "Ensemblis will develop the direction you already chose. It will not ask you to choose another set of concepts."}</p>
      {snapshot?.rationale ? <blockquote>{snapshot.rationale}</blockquote> : null}
      <div className="video-project-card-meta">
        <span>{data.track.title}</span>
        <span>{data.project.primary_aspect_ratio}</span>
        <span>{data.project.target_resolution}</span>
        <span>{credits(data.project.hard_budget_credits)} hard cap</span>
      </div>
      <form action={developQuickVideoDirection} className="video-section-action">
        <input type="hidden" name="project_id" value={data.project.id} />
        <SubmitButton
          pendingLabel="Developing direction and production plan..."
          disabled={!data.services.director.configured}
        >
          {developing ? "Finish production plan" : "Develop this direction"}
        </SubmitButton>
        <small>This step creates the treatment, visual system, storyboard and cost plan. It spends 0 generation credits.</small>
      </form>
    </section>
  );
}

function PreviewPlan({ data }: { data: VideoWorkspaceData }) {
  const plan = record(data.project.production_plan);
  const cost = record(plan.cost_estimate);
  const reserve = typeof cost.total_reserve_credits === "number" ? cost.total_reserve_credits : Number(data.project.estimated_credits);
  const available = availableBudget(data.project);
  const withinBudget = reserve <= available + 0.001;
  const uniqueSources = typeof cost.unique_source_sequences === "number" ? cost.unique_source_sequences : data.shots.length;
  const editorialReuse = typeof cost.editorial_reuse_shots === "number" ? cost.editorial_reuse_shots : 0;
  const verticalSafe = data.shots.filter((shot) => record(shot.generation_params).vertical_safe === true).length;
  return (
    <section className="workspace-section" id="quick-preview-plan">
      <div className="section-head">
        <div><span className="section-label">Representative preview</span><h2>The film is planned. Validate the world before motion scales.</h2></div>
        <Status>{withinBudget ? "Within hard cap" : "Budget needs attention"}</Status>
      </div>
      <p className="section-copy">Ensemblis has already built the detailed storyboard and provider routing underneath. Your next meaningful decision is whether the visual world deserves production.</p>
      <div className="video-cost-plan">
        <div><small>Estimated production</small><strong>{credits(Number(cost.total_credits ?? data.project.estimated_credits))}</strong></div>
        <div><small>Conservative reserve</small><strong>{credits(reserve)}</strong></div>
        <div><small>Unique source sequences</small><strong>{uniqueSources}</strong></div>
        <div><small>Editorial reuse</small><strong>{editorialReuse}</strong></div>
        <div className="total"><small>Social-safe compositions</small><strong>{verticalSafe}/{data.shots.length}</strong><span>Hard cap: {credits(data.project.hard_budget_credits)}</span></div>
      </div>
      <form action={approveVideoProductionPlan} className="video-section-action">
        <input type="hidden" name="project_id" value={data.project.id} />
        <SubmitButton pendingLabel="Preparing representative preview..." disabled={!withinBudget}>Prepare representative visual preview</SubmitButton>
        {withinBudget
          ? <small>This approval spends 0 credits. The next screen shows the exact preview-generation spend before anything is submitted.</small>
          : <small>The conservative reserve is above the remaining hard cap. Open Director Pro to reduce scope or change the budget.</small>}
      </form>
    </section>
  );
}

function CurrentQuickStage({ data }: { data: VideoWorkspaceData }) {
  switch (data.project.status) {
    case "draft":
    case "analyzing_audio":
      return <TrackIntelligenceInspector data={data} />;
    case "concept_review":
    case "treatment_review":
      return <DirectionDevelopment data={data} />;
    case "production_plan_review":
      return <PreviewPlan data={data} />;
    case "look_dev":
    case "look_review":
      return <LookDevelopmentPanel data={data} />;
    case "test_generation":
      return <GenerationPanel data={data} />;
    case "test_review":
      return <ShotReviewPanel data={data} />;
    case "production":
      return <GenerationPanel data={data} />;
    case "shot_review":
      return <ShotReviewPanel data={data} />;
    case "ready_to_render":
    case "rendering":
    case "complete":
      return <DeliveryPanel data={data} />;
    case "blocked":
    case "failed":
    case "archived":
      return <RecoveryPanel data={data} />;
  }
}

export function QuickVideoProjectWorkspace({ data }: { data: VideoWorkspaceData }) {
  const phase = phaseForStatus(data.project.status);
  const brief = parseVideoCreativeBrief(data.project.creative_brief);
  return (
    <div className="video-project-workspace">
      <ProjectHeader project={data.project} release={data.release} track={data.track} />

      <section className="workspace-section">
        <div className="section-head">
          <div><span className="section-label">Quick Video</span><h2>Four outcomes, one production engine</h2></div>
          <Link className="button" href={`/studio/video/${data.project.id}?mode=pro`}>Open Director Pro</Link>
        </div>
        <div className="video-cost-plan">
          {QUICK_PHASES.map((item) => (
            <div className={item.id === phase ? "total" : undefined} key={item.id}>
              <small>{phaseState(phase, item.id)}</small>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
          ))}
        </div>
      </section>

      {phase === "attention" ? null : <RecoveryPanel data={data} />}

      <div className="video-production-layout">
        <main className="workspace-stack">
          <CurrentQuickStage data={data} />
        </main>
        <aside className="video-production-sidebar">
          <section className="workspace-section">
            <div className="section-head"><div><span className="section-label">Creative intent</span><h2>{brief.concept_snapshot?.title ?? "Quick Video"}</h2></div></div>
            <p>{brief.concept_snapshot?.description ?? "Music-aware direction selected before production."}</p>
            {brief.note ? <p><strong>Protect:</strong> {brief.note}</p> : null}
            <dl>
              <div><dt>Track</dt><dd>{data.track.title}</dd></div>
              <div><dt>Spent</dt><dd>{credits(data.project.spent_credits)}</dd></div>
              <div><dt>Reserved</dt><dd>{credits(data.project.reserved_credits)}</dd></div>
              <div><dt>Available</dt><dd>{credits(availableBudget(data.project))}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
