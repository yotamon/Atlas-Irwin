import type { SupabaseClient } from "@supabase/supabase-js";

export type VerifiedMomentLearningEvidence = {
  metric_snapshot_id: string;
  owner_id: string;
  artist_id: string;
  content_item_id: string;
  moment_id: string;
  track_id: string;
  release_id: string;
  campaign_id: string | null;
  platform: string;
  format: string;
  goal: string;
  moment_type: string;
  moment_label: string;
  source_mode: string;
  purpose_tags: string[];
  moment_confidence: number;
  vocal_score: number | null;
  hook_score: number | null;
  emotional_score: number | null;
  energy_score: number | null;
  uniqueness_score: number | null;
  metric_source: string;
  external_object_id: string;
  captured_at: string;
  date: string;
  reach: number;
  views: number;
  watch_time: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  profile_visits: number;
  follows: number;
  link_clicks: number;
  streams: number;
  listeners: number;
  playlist_adds: number;
  content_variant_id: string | null;
  creative_recipe_id: string | null;
  creative_recipe: unknown;
};

type View<Row> = {
  Row: Row;
  Relationships: [];
};

type LearningEvidenceDatabase = {
  public: {
    Tables: {};
    Views: {
      verified_moment_learning_evidence: View<VerifiedMomentLearningEvidence>;
      verified_creative_learning_evidence: View<VerifiedMomentLearningEvidence>;
    };
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
};

export function asLearningEvidenceClient(client: SupabaseClient) {
  return client as unknown as SupabaseClient<LearningEvidenceDatabase>;
}
