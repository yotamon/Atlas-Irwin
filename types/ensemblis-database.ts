import type { Json } from "@/types/database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type WorkspaceKind = "personal" | "team" | "label";
export type WorkspaceRole =
  | "owner"
  | "admin"
  | "manager"
  | "creative"
  | "marketing"
  | "analyst"
  | "viewer";
export type WorkspaceMembershipStatus = "active" | "invited" | "suspended";
export type ArtistProjectType = "human" | "ai_assisted" | "hybrid" | "virtual_persona";
export type ArtistStatus = "active" | "paused" | "archived";
export type MarketingInvolvement = "hands_on" | "guided" | "just_make_music";
export type ArtistCareerStage = "starting" | "emerging" | "active" | "established";
export type ArtistGoalKind = "get_heard" | "release_music" | "get_gigs" | "grow_fans" | "find_labels" | "build_owned_audience";
export type ArtistVisibilityMode = "face_forward" | "selective" | "music_first" | "anonymous";
export type ArtistReleaseCadence = "frequent" | "steady" | "occasional";
export type ArtistSceneRelationshipType = "similar_artist" | "label" | "playlist" | "channel" | "promoter" | "venue" | "festival" | "market" | "community";

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  kind: WorkspaceKind;
  created_by: string | null;
  legacy_owner_id: string | null;
  timezone: string | null;
  locale: string | null;
  currency: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkspaceMembership = {
  workspace_id: string;
  profile_id: string;
  role: WorkspaceRole;
  status: WorkspaceMembershipStatus;
  created_at: string;
  updated_at: string;
};

export type Artist = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  project_type: ArtistProjectType;
  status: ArtistStatus;
  avatar_url: string | null;
  accent_color: string | null;
  legacy_owner_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ArtistOperatingProfileRow = {
  artist_id: string;
  marketing_involvement: MarketingInvolvement;
  career_stage: ArtistCareerStage;
  primary_goal: ArtistGoalKind;
  visibility_mode: ArtistVisibilityMode;
  content_comfort: string[];
  release_cadence: ArtistReleaseCadence;
  monthly_budget_cents: number;
  currency: string;
  ai_writing_allowed: boolean;
  ai_visuals_allowed: boolean;
  ai_music_allowed: boolean;
  ai_voice_allowed: boolean;
  ai_likeness_allowed: boolean;
  disclosure_preference: "required_only" | "always";
  created_at: string;
  updated_at: string;
};

export type ArtistGoalRow = {
  id: string;
  artist_id: string;
  kind: ArtistGoalKind;
  priority: number;
  status: "active" | "paused" | "achieved";
  target: Json;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ArtistSceneProfileRow = {
  artist_id: string;
  primary_scene: string | null;
  sub_scenes: string[];
  geographic_affinities: string[];
  audience_hypotheses: Json;
  evidence: Json;
  confidence: number;
  created_at: string;
  updated_at: string;
};

export type ArtistSceneRelationshipRow = {
  id: string;
  artist_id: string;
  relationship_type: ArtistSceneRelationshipType;
  target_name: string;
  target_url: string | null;
  external_id: string | null;
  fit_score: number;
  confidence: number;
  evidence: Json;
  status: "candidate" | "verified" | "dismissed" | "contacted";
  observed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ArtistStrategySnapshotRow = {
  id: string;
  artist_id: string;
  status: "active" | "superseded";
  strategy: Json;
  source_context: Json;
  created_at: string;
  superseded_at: string | null;
};

export type EnsemblisDatabase = {
  public: {
    Tables: {
      workspaces: Table<Workspace>;
      workspace_memberships: Table<WorkspaceMembership>;
      artists: Table<Artist>;
      artist_operating_profiles: Table<ArtistOperatingProfileRow>;
      artist_goals: Table<ArtistGoalRow>;
      artist_scene_profiles: Table<ArtistSceneProfileRow>;
      artist_scene_relationships: Table<ArtistSceneRelationshipRow>;
      artist_strategy_snapshots: Table<ArtistStrategySnapshotRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
