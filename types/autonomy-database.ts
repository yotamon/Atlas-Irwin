import type { Json } from "@/types/database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type AudienceInteraction = {
  id: string;
  owner_id: string;
  platform: "instagram" | "youtube" | "tiktok";
  interaction_type: "comment" | "reply" | "message" | "mention";
  external_interaction_id: string;
  external_parent_id: string | null;
  external_post_id: string | null;
  author_name: string | null;
  author_handle: string | null;
  body: string;
  occurred_at: string;
  status: "new" | "needs_reply" | "drafted" | "approved" | "replied" | "ignored";
  suggested_reply: string | null;
  reply_confidence: number | null;
  auto_reply_eligible: boolean;
  sentiment: "positive" | "neutral" | "negative" | "question" | null;
  raw: Json;
  created_at: string;
  updated_at: string;
};

export type MarketingOpportunity = {
  id: string;
  owner_id: string;
  kind: "trend" | "content_angle" | "collaboration" | "playlist" | "event" | "breakout" | "risk";
  source: string;
  external_key: string;
  title: string;
  summary: string;
  url: string | null;
  score: number;
  urgency: number;
  expires_at: string | null;
  evidence: Json;
  recommended_action: string | null;
  status: "new" | "accepted" | "dismissed" | "converted" | "expired";
  created_at: string;
  updated_at: string;
};

export type NextBestAction = {
  id: string;
  owner_id: string;
  action_type: string;
  title: string;
  rationale: string;
  score: number;
  source_type: string | null;
  source_id: string | null;
  payload: Json;
  idempotency_key: string;
  status: "proposed" | "approved" | "executing" | "completed" | "dismissed" | "expired";
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AutomationRuntimeSecret = {
  key: string;
  secret_hash: string;
  created_at: string;
  updated_at: string;
};

export type AutonomyDatabase = {
  public: {
    Tables: {
      audience_interactions: Table<AudienceInteraction>;
      marketing_opportunities: Table<MarketingOpportunity>;
      next_best_actions: Table<NextBestAction>;
      automation_runtime_secrets: Table<AutomationRuntimeSecret>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
