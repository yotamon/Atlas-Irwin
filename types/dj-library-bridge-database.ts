import type { Database, Json } from "./database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type DjLibrarySourceKind = "local_library" | "rekordbox" | "serato" | "traktor";
export type DjLibraryDeviceJobStatus = "queued" | "claimed" | "completed" | "failed" | "cancelled";

export type DjLibraryDeviceRow = {
  id: string;
  owner_id: string;
  artist_id: string;
  public_id: string;
  name: string;
  platform: "windows" | "macos" | "linux";
  app_version: string;
  credential_hash: string;
  credential_prefix: string;
  capabilities: Json;
  paired_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DjLibraryPairingCodeRow = {
  id: string;
  owner_id: string;
  artist_id: string;
  code_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export type DjLibraryDeviceSourceRow = {
  id: string;
  device_id: string;
  owner_id: string;
  artist_id: string;
  source_id: string;
  source_kind: DjLibrarySourceKind;
  revision: string | null;
  track_count: number;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DjLibrarySourceTrackRow = {
  id: string;
  device_id: string;
  device_source_id: string;
  owner_id: string;
  artist_id: string;
  source_id: string;
  source_track_id: string;
  recording_fingerprint: string;
  metadata: Json;
  playlist_ids: Json;
  cue_points: Json;
  beat_grid: Json | null;
  analysis_provenance: Json;
  planning_evidence: Json | null;
  availability: "available" | "missing" | "offline" | "unknown";
  revision: string;
  created_at: string;
  updated_at: string;
};

export type DjLibrarySyncChunkRow = {
  id: string;
  device_id: string;
  owner_id: string;
  artist_id: string;
  source_id: string;
  source_kind: DjLibrarySourceKind;
  base_revision: string | null;
  target_revision: string;
  batch_index: number;
  batch_count: number;
  payload: Json;
  created_at: string;
};

export type DjLibraryDeviceJobRow = {
  id: string;
  device_id: string;
  owner_id: string;
  artist_id: string;
  idempotency_key: string;
  job_type: "resolve_media";
  source_revision: string | null;
  payload: Json;
  status: DjLibraryDeviceJobStatus;
  result: Json | null;
  error: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type ExistingTables = Database["public"]["Tables"];
type ExistingFunctions = Database["public"]["Functions"];

export type DjLibraryBridgeDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: ExistingTables & {
      dj_library_devices: Table<DjLibraryDeviceRow>;
      dj_library_pairing_codes: Table<DjLibraryPairingCodeRow>;
      dj_library_device_sources: Table<DjLibraryDeviceSourceRow>;
      dj_library_source_tracks: Table<DjLibrarySourceTrackRow>;
      dj_library_sync_chunks: Table<DjLibrarySyncChunkRow>;
      dj_library_device_jobs: Table<DjLibraryDeviceJobRow>;
    };
    Functions: ExistingFunctions & {
      claim_dj_library_pairing: {
        Args: {
          p_code_hash: string;
          p_public_id: string;
          p_name: string;
          p_platform: string;
          p_app_version: string;
          p_credential_hash: string;
          p_credential_prefix: string;
          p_capabilities: Json;
        };
        Returns: { device_id: string; owner_id: string; artist_id: string }[];
      };
      apply_dj_library_sync_revision: {
        Args: {
          p_device_id: string;
          p_source_id: string;
          p_source_kind: string;
          p_base_revision: string | null;
          p_target_revision: string;
          p_batch_count: number;
        };
        Returns: { revision: string; track_count: number }[];
      };
      claim_dj_library_device_jobs: {
        Args: { p_device_id: string; p_limit?: number };
        Returns: {
          id: string;
          idempotency_key: string;
          job_type: string;
          source_revision: string | null;
          payload: Json;
        }[];
      };
    };
  };
};