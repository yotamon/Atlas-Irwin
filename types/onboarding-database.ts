import type { Database, Json } from "@/types/database";

type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

export type ArtistActivationEvent = {
  id: string;
  owner_id: string;
  artist_id: string;
  event_type: "onboarding_started" | "artist_identity_confirmed" | "first_music_added" | "first_intelligence_ready" | "first_release_mission" | "first_moment_curated" | "first_moment_approved" | "first_useful_recommendation" | "onboarding_dismissed";
  source_id: string | null;
  metadata: Json;
  occurred_at: string;
  created_at: string;
};

export type OnboardingMoment = {
  id: string;
  owner_id: string;
  artist_id: string;
  release_id: string;
  track_id: string;
  label: string;
  state: "proposed" | "approved" | "rejected" | "superseded";
  confidence: number;
  created_at: string;
};

export type OnboardingDatabase = {
  public: {
    Tables: Omit<Database["public"]["Tables"], "moments"> & {
      moments: Table<OnboardingMoment>;
      artist_activation_events: Table<ArtistActivationEvent>;
    };
    Views: Database["public"]["Views"];
    Functions: Database["public"]["Functions"] & {
      confirm_ensemblis_artist_identity: {
        Args: { p_artist_id: string; p_name: string; p_project_type: string };
        Returns: string;
      };
      record_ensemblis_activation_ui_event: {
        Args: { p_artist_id: string; p_event_type: string };
        Returns: undefined;
      };
    };
    Enums: Database["public"]["Enums"];
    CompositeTypes: Database["public"]["CompositeTypes"];
  };
  private: Database["private"];
};