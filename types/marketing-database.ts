import type { ContentItem, Json, MetricSnapshot, OutreachMessage } from "@/types/database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type CampaignStatus = "draft" | "planned" | "active" | "paused" | "completed" | "archived";
export type CampaignMode = "suggest" | "assisted" | "autopilot";
export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected";
export type AiRoutingMode = "auto" | "economy" | "balanced" | "premium";
export type AiProviderSort = "cost" | "ttft" | "tps";
export type AiUserOutcome = "accepted" | "edited" | "rejected" | "regenerated" | "published" | "unknown";
export type AiFeedbackEventType = "accepted" | "edited" | "rejected" | "regenerated" | "published" | "performance";

export type Campaign = {
  id: string;
  owner_id: string;
  release_id: string | null;
  name: string;
  status: CampaignStatus;
  mode: CampaignMode;
  objective: string;
  primary_kpi: string;
  secondary_kpis: string[];
  audience_segments: Json;
  strategy: Json;
  release_anchor_date: string | null;
  start_date: string | null;
  end_date: string | null;
  budget_cents: number;
  spent_cents: number;
  learning_summary: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignPhase = {
  id: string;
  owner_id: string;
  campaign_id: string;
  code: string;
  name: string;
  objective: string;
  relative_start_days: number;
  relative_end_days: number;
  starts_at: string | null;
  ends_at: string | null;
  status: "planned" | "active" | "completed" | "skipped";
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CampaignExperiment = {
  id: string;
  owner_id: string;
  campaign_id: string;
  phase_id: string | null;
  title: string;
  hypothesis: string;
  goal: string;
  primary_metric: string;
  status: "planned" | "running" | "evaluating" | "winner_found" | "inconclusive" | "stopped";
  minimum_sample: number;
  minimum_lift: number;
  evaluation_window_hours: number;
  winner_variant_id: string | null;
  result_summary: string | null;
  created_at: string;
  updated_at: string;
};

export type GenerationRun = {
  id: string;
  owner_id: string;
  campaign_id: string | null;
  release_id: string | null;
  video_project_id: string | null;
  parent_run_id: string | null;
  purpose: string;
  task_type: string | null;
  provider: string;
  model: string;
  requested_model: string | null;
  routed_provider: string | null;
  gateway_generation_id: string | null;
  prompt_version: string;
  input_context: Json;
  output: Json;
  status: "queued" | "running" | "completed" | "failed";
  attempt_index: number;
  started_at: string | null;
  completed_at: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  provider_request_id: string | null;
  fallback_used: boolean;
  fallback_count: number;
  escalated: boolean;
  escalation_reason: string | null;
  quality_gate_passed: boolean | null;
  quality_score: number | null;
  quality_failures: Json;
  user_outcome: AiUserOutcome | null;
  edit_distance_ratio: number | null;
  outcome_recorded_at: string | null;
  metadata: Json;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type AiControlSettings = {
  owner_id: string;
  routing_mode: AiRoutingMode;
  monthly_budget_usd: number;
  text_budget_usd: number;
  image_budget_usd: number;
  video_budget_usd: number;
  hard_stop: boolean;
  quality_escalation: boolean;
  provider_sort: AiProviderSort;
  task_overrides: Json;
  created_at: string;
  updated_at: string;
};

export type AiFeedbackEvent = {
  id: string;
  owner_id: string;
  generation_run_id: string;
  event_type: AiFeedbackEventType;
  entity_type: string | null;
  entity_id: string | null;
  edit_distance_ratio: number | null;
  quality_signal: number | null;
  metadata: Json;
  created_at: string;
};

export type MarketingContentItem = ContentItem & {
  campaign_id: string | null;
  phase_id: string | null;
  experiment_id: string | null;
  approval_status: ApprovalStatus;
  source: "manual" | "planner" | "ai" | "automation";
  generated_from_run_id: string | null;
  content_angle: string | null;
  audience_segment: string | null;
  relative_day: number | null;
  schedule_locked: boolean;
  schedule_local_time: string;
  schedule_timezone: string;
};

export type ContentVariant = {
  id: string;
  owner_id: string;
  content_item_id: string;
  experiment_id: string | null;
  generation_run_id: string | null;
  label: string;
  hypothesis: string | null;
  hook_text: string | null;
  caption: string | null;
  cta: string | null;
  visual_prompt: string | null;
  production_notes: string | null;
  asset_url: string | null;
  status: "draft" | "ready" | "approved" | "scheduled" | "published" | "rejected" | "archived";
  approval_status: ApprovalStatus;
  is_control: boolean;
  scheduled_at: string | null;
  published_at: string | null;
  external_post_id: string | null;
  attribution_code: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicationJob = {
  id: string;
  owner_id: string;
  campaign_id: string | null;
  content_item_id: string | null;
  content_variant_id: string | null;
  platform: string;
  adapter: string;
  status: "draft" | "awaiting_approval" | "approved" | "scheduled" | "publishing" | "provider_scheduled" | "manual_ready" | "published" | "failed" | "cancelled";
  requires_approval: boolean;
  approval_status: ApprovalStatus;
  scheduled_at: string | null;
  published_at: string | null;
  external_post_id: string | null;
  external_url: string | null;
  request_payload: Json;
  result: Json;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
};

export type AttributionLink = {
  id: string;
  owner_id: string;
  campaign_id: string;
  content_item_id: string | null;
  content_variant_id: string | null;
  code: string;
  platform: string | null;
  destination_url: string;
  label: string | null;
  is_active: boolean;
  click_count: number;
  unique_click_count: number;
  last_clicked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AttributionEvent = {
  id: string;
  owner_id: string;
  attribution_link_id: string;
  event_type: "click" | "landing" | "conversion";
  visitor_hash: string | null;
  referrer: string | null;
  user_agent: string | null;
  metadata: Json;
  occurred_at: string;
  created_at: string;
  updated_at: string;
};

export type MarketingEvent = {
  id: string;
  owner_id: string;
  campaign_id: string | null;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: Json;
  occurred_at: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AutomationJob = {
  id: string;
  owner_id: string;
  campaign_id: string | null;
  source_event_id: string | null;
  job_type: string;
  payload: Json;
  status: "queued" | "awaiting_approval" | "running" | "completed" | "failed" | "cancelled";
  requires_approval: boolean;
  approval_status: ApprovalStatus;
  run_after: string;
  attempt_count: number;
  max_attempts: number;
  locked_at: string | null;
  completed_at: string | null;
  result: Json;
  error: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingLearning = {
  id: string;
  owner_id: string;
  campaign_id: string | null;
  release_id: string | null;
  experiment_id: string | null;
  scope: "brand" | "platform" | "audience" | "campaign" | "release" | "experiment" | "content";
  finding: string;
  evidence: Json;
  confidence: number;
  status: "proposed" | "approved" | "rejected" | "superseded";
  applies_to: Json;
  source: "analysis" | "manual" | "experiment" | "import";
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingMetricSnapshot = MetricSnapshot & {
  campaign_id: string | null;
  experiment_id: string | null;
  content_variant_id: string | null;
  source: string;
  external_object_id: string | null;
  captured_at: string;
};

export type OutreachSequence = {
  id: string;
  owner_id: string;
  campaign_id: string | null;
  name: string;
  status: "draft" | "active" | "paused" | "completed" | "archived";
  audience_filter: Json;
  stop_on_reply: boolean;
  created_at: string;
  updated_at: string;
};

export type OutreachSequenceStep = {
  id: string;
  owner_id: string;
  sequence_id: string;
  step_order: number;
  delay_days: number;
  channel: string;
  subject_template: string | null;
  message_template: string;
  objective: string | null;
  requires_approval: boolean;
  created_at: string;
  updated_at: string;
};

export type OutreachEnrollment = {
  id: string;
  owner_id: string;
  sequence_id: string;
  contact_id: string;
  campaign_id: string | null;
  status: "active" | "paused" | "completed" | "stopped" | "failed";
  next_step_order: number;
  next_run_at: string | null;
  stopped_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingOutreachMessage = OutreachMessage & {
  sequence_enrollment_id: string | null;
  sequence_step_id: string | null;
  campaign_id: string | null;
};

export type MarketingDatabase = {
  public: {
    Tables: {
      campaigns: Table<Campaign>;
      campaign_phases: Table<CampaignPhase>;
      campaign_experiments: Table<CampaignExperiment>;
      generation_runs: Table<GenerationRun>;
      ai_control_settings: Table<AiControlSettings>;
      ai_feedback_events: Table<AiFeedbackEvent>;
      content_items: Table<MarketingContentItem>;
      content_variants: Table<ContentVariant>;
      publication_jobs: Table<PublicationJob>;
      attribution_links: Table<AttributionLink>;
      attribution_events: Table<AttributionEvent>;
      marketing_events: Table<MarketingEvent>;
      automation_jobs: Table<AutomationJob>;
      marketing_learnings: Table<MarketingLearning>;
      metric_snapshots: Table<MarketingMetricSnapshot>;
      outreach_sequences: Table<OutreachSequence>;
      outreach_sequence_steps: Table<OutreachSequenceStep>;
      outreach_enrollments: Table<OutreachEnrollment>;
      outreach_messages: Table<MarketingOutreachMessage>;
    };
    Views: Record<string, never>;
    Functions: {
      record_attribution_click: {
        Args: {
          p_code: string;
          p_visitor_hash: string;
          p_referrer?: string | null;
          p_user_agent?: string | null;
        };
        Returns: Array<{
          destination_url: string;
          link_id: string;
          is_unique: boolean;
        }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};