use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DEVICE_SYNC_VERSION: &str = "ensemblis.dj-library-device-sync.v1";
pub const DEVICE_JOB_VERSION: &str = "ensemblis.dj-library-device-job.v1";
pub const PLANNING_EVIDENCE_VERSION: &str = "ensemblis.dj-library-planning-evidence.v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackMetadata {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub remix: Option<String>,
    pub genre: Option<String>,
    pub comments: Option<String>,
    pub duration_ms: Option<u64>,
    pub bpm: Option<f64>,
    pub musical_key: Option<String>,
    pub rating: Option<u8>,
    pub color: Option<String>,
    pub tags: Vec<String>,
    pub year: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CloudTrackDelta {
    pub source_track_id: String,
    pub recording_fingerprint: String,
    pub metadata: TrackMetadata,
    pub playlist_ids: Vec<String>,
    pub cue_points: Value,
    pub beat_grid: Value,
    pub analysis_provenance: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planning_evidence: Option<Value>,
    pub availability: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceDelta {
    pub source_id: String,
    pub source_kind: String,
    pub base_revision: Option<String>,
    pub target_revision: String,
    pub changed_tracks: Vec<CloudTrackDelta>,
    pub removed_source_track_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncEnvelope {
    pub version: String,
    pub delta: SourceDelta,
}

#[derive(Debug, Clone)]
pub struct ScannedTrack {
    pub path: std::path::PathBuf,
    pub file_size: u64,
    pub modified_unix_ms: i64,
    pub payload_hash: String,
    pub cloud: CloudTrackDelta,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub source_id: String,
    pub source_kind: String,
    pub revision: String,
    pub track_count: usize,
    pub changed_count: usize,
    pub removed_count: usize,
    pub queued_for_sync: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairResponse {
    pub device_id: String,
    pub credential: String,
    pub artist_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceJob {
    pub version: String,
    pub id: String,
    pub idempotency_key: String,
    pub job_type: String,
    pub source_revision: Option<String>,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceJobResult {
    pub job_id: String,
    pub status: String,
    pub result: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub paired: bool,
    pub device_id: Option<String>,
    pub api_base_url: Option<String>,
    pub sources: usize,
    pub pending_sync_batches: usize,
}
