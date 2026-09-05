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

export type EnsemblisDatabase = {
  public: {
    Tables: {
      workspaces: Table<Workspace>;
      workspace_memberships: Table<WorkspaceMembership>;
      artists: Table<Artist>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};