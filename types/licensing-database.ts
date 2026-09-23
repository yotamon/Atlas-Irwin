import type { Database, Json } from "./database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type EnsemblisCapabilityGrantRow = {
  id: string;
  owner_id: string;
  capability: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EnsemblisPerpetualLicenseRow = {
  id: string;
  owner_id: string;
  major_version: number;
  device_limit: number;
  active: boolean;
  purchased_at: string;
  created_at: string;
  updated_at: string;
};

export type EnsemblisLicenseActivationRow = {
  license_id: string;
  device_id: string;
  owner_id: string;
  activated_at: string;
  revoked_at: string | null;
};

export type EnsemblisModelCatalogRow = {
  id: string;
  version: string;
  platform: string;
  architecture: string;
  url: string;
  sha256: string;
  size_bytes: number;
  required_capability: string | null;
  metadata: Json;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type EnsemblisExecutionTelemetryRow = {
  id: string;
  owner_id: string | null;
  task_id: string;
  processor_id: string;
  processor_version: string;
  target: string;
  started_at: string;
  duration_ms: number;
  queue_ms: number | null;
  input_bytes: number;
  output_bytes: number;
  cpu_ms: number | null;
  gpu_ms: number | null;
  hardware_class: string | null;
  provider: string | null;
  estimated_cost_microunits: number | null;
  currency: string | null;
  created_at: string;
};

type ExistingTables = Database["public"]["Tables"];
type ExistingFunctions = Database["public"]["Functions"];

export type LicensingDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: ExistingTables & {
      ensemblis_capability_grants: Table<EnsemblisCapabilityGrantRow>;
      ensemblis_perpetual_licenses: Table<EnsemblisPerpetualLicenseRow>;
      ensemblis_license_activations: Table<EnsemblisLicenseActivationRow>;
      ensemblis_model_catalog: Table<EnsemblisModelCatalogRow>;
      ensemblis_execution_telemetry: Table<EnsemblisExecutionTelemetryRow>;
    };
    Functions: ExistingFunctions & {
      activate_ensemblis_perpetual_license: {
        Args: {
          p_owner_id: string;
          p_device_id: string;
          p_major_version: number;
        };
        Returns: {
          license_id: string;
          activated: boolean;
          device_limit: number;
        }[];
      };
    };
  };
};
