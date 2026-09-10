import type { Json } from "@/types/database";
import type { ArtistScopedAutonomyDatabase } from "@/types/artist-scoped-operational-database";

export type FanRelationshipState = "new" | "returning" | "known_supporter" | "inactive";
export type FanChannel = "instagram" | "youtube" | "tiktok" | "email" | "sms";
export type FanIdentityKind = "platform_handle" | "provider_subject" | "verified_email" | "verified_phone";
export type FanIdentityEvidence = "observed" | "verified" | "explicit";
export type FanPermissionPurpose = "proactive_updates" | "release_marketing" | "email_marketing" | "sms_marketing";
export type FanPermissionStatus = "unknown" | "granted" | "revoked";

export type FanProfile = {
  id: string;
  owner_id: string;
  artist_id: string;
  display_name: string | null;
  relationship_state: FanRelationshipState;
  first_seen_at: string;
  last_seen_at: string;
  interaction_count: number;
  merged_into_fan_id: string | null;
  created_at: string;
  updated_at: string;
};

export type FanIdentity = {
  id: string;
  fan_id: string;
  owner_id: string;
  artist_id: string;
  channel: FanChannel;
  identifier_kind: FanIdentityKind;
  external_subject_id: string;
  handle: string | null;
  display_name: string | null;
  evidence_level: FanIdentityEvidence;
  verified_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type FanPermission = {
  id: string;
  identity_id: string;
  owner_id: string;
  artist_id: string;
  channel: FanChannel;
  purpose: FanPermissionPurpose;
  status: FanPermissionStatus;
  source: "artist_record" | "fan_opt_in" | "provider_sync" | "privacy_request";
  evidence_at: string | null;
  evidence_note: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FanInteractionLink = {
  interaction_id: string;
  identity_id: string;
  owner_id: string;
  artist_id: string;
  linked_at: string;
};

export type FanMergeEvent = {
  id: string;
  owner_id: string;
  artist_id: string;
  source_fan_id: string;
  target_fan_id: string;
  evidence_type: "explicit_confirmation" | "verified_contact_match" | "provider_verified_link";
  evidence_note: string;
  moved_identity_ids: string[];
  status: "active" | "reverted" | "privacy_deleted";
  merged_at: string;
  reverted_at: string | null;
  created_at: string;
};

export type FanPrivacyEvent = {
  id: string;
  owner_id: string;
  artist_id: string;
  fan_id: string;
  request_type: "export" | "revoke" | "delete";
  channel: string | null;
  result_summary: Json;
  created_at: string;
};

type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

export type FanGraphDatabase = Omit<ArtistScopedAutonomyDatabase, "public"> & {
  public: Omit<ArtistScopedAutonomyDatabase["public"], "Tables" | "Functions"> & {
    Tables: ArtistScopedAutonomyDatabase["public"]["Tables"] & {
      fan_profiles: Table<FanProfile>;
      fan_identities: Table<FanIdentity>;
      fan_permissions: Table<FanPermission>;
      fan_interaction_links: Table<FanInteractionLink>;
      fan_merge_events: Table<FanMergeEvent>;
      fan_privacy_events: Table<FanPrivacyEvent>;
    };
    Functions: ArtistScopedAutonomyDatabase["public"]["Functions"] & {
      merge_fan_profiles: { Args: { p_source_fan_id: string; p_target_fan_id: string; p_evidence_type: string; p_evidence_note: string }; Returns: string };
      revert_fan_merge: { Args: { p_merge_id: string }; Returns: undefined };
      record_fan_export: { Args: { p_fan_id: string }; Returns: undefined };
      revoke_fan_permissions: { Args: { p_fan_id: string; p_channel?: string | null }; Returns: number };
      delete_fan_personal_data: { Args: { p_fan_id: string }; Returns: undefined };
    };
  };
};
