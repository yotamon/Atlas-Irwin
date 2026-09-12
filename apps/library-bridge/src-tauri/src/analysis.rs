use crate::privacy::{assert_path_free_value, assert_recording_fingerprint};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const TRACK_PLANNING_PROCESSOR_ID: &str = "dj.track-planning-intelligence";
pub const TRACK_PLANNING_PROCESSOR_VERSION: &str = "ensemblis.library-bridge.analyzer.v1";
pub const TRACK_PLANNING_MODEL_ID: &str = "atlas-ti";
pub const TRACK_PLANNING_MODEL_VERSION: &str = "atlas-ti-v4.0.0";
pub const TRACK_PLANNING_SCHEMA_VERSION: &str = "ensemblis.library-bridge.analysis-payload.v1";
pub const TRACK_PLANNING_EVIDENCE_VERSION: &str = "ensemblis.dj-library-planning-evidence.v1";
pub const TRACK_PLANNING_PARAMETERS_HASH: &str =
    "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
const MAX_ANALYSIS_PAYLOAD_BYTES: usize = 96 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisArtifactKey {
    pub recording_fingerprint: String,
    pub processor_id: String,
    pub processor_version: String,
    pub model_id: String,
    pub model_version: String,
    pub schema_version: String,
    pub parameters_hash: String,
}

impl AnalysisArtifactKey {
    pub fn validate(&self) -> anyhow::Result<()> {
        assert_recording_fingerprint(&self.recording_fingerprint, "recordingFingerprint")?;
        assert_recording_fingerprint(&self.parameters_hash, "parametersHash")?;
        for (field, value) in [
            ("processorId", self.processor_id.as_str()),
            ("processorVersion", self.processor_version.as_str()),
            ("modelId", self.model_id.as_str()),
            ("modelVersion", self.model_version.as_str()),
            ("schemaVersion", self.schema_version.as_str()),
        ] {
            if value.trim().is_empty() {
                anyhow::bail!("analysis artifact {field} is required");
            }
        }
        Ok(())
    }
}

pub fn track_planning_artifact_key(
    recording_fingerprint: &str,
) -> anyhow::Result<AnalysisArtifactKey> {
    assert_recording_fingerprint(recording_fingerprint, "recordingFingerprint")?;
    Ok(AnalysisArtifactKey {
        recording_fingerprint: recording_fingerprint.to_string(),
        processor_id: TRACK_PLANNING_PROCESSOR_ID.to_string(),
        processor_version: TRACK_PLANNING_PROCESSOR_VERSION.to_string(),
        model_id: TRACK_PLANNING_MODEL_ID.to_string(),
        model_version: TRACK_PLANNING_MODEL_VERSION.to_string(),
        schema_version: TRACK_PLANNING_SCHEMA_VERSION.to_string(),
        parameters_hash: TRACK_PLANNING_PARAMETERS_HASH.to_string(),
    })
}

fn required_object<'a>(
    root: &'a serde_json::Map<String, Value>,
    key: &str,
) -> anyhow::Result<&'a serde_json::Map<String, Value>> {
    root.get(key)
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow::anyhow!("local analysis payload is missing {key}"))
}

pub fn validate_track_planning_payload(
    expected_fingerprint: &str,
    payload: &Value,
) -> anyhow::Result<()> {
    assert_recording_fingerprint(expected_fingerprint, "recordingFingerprint")?;
    if serde_json::to_vec(payload)?.len() > MAX_ANALYSIS_PAYLOAD_BYTES {
        anyhow::bail!("local analysis payload exceeds the safety budget");
    }
    let root = payload
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("local analysis payload must be an object"))?;
    if root.get("version").and_then(Value::as_str) != Some(TRACK_PLANNING_SCHEMA_VERSION) {
        anyhow::bail!("local analysis payload uses an unsupported schema");
    }
    if root.get("analyzerVersion").and_then(Value::as_str)
        != Some(TRACK_PLANNING_PROCESSOR_VERSION)
    {
        anyhow::bail!("local analysis payload uses an unexpected processor version");
    }
    if root.get("recordingFingerprint").and_then(Value::as_str) != Some(expected_fingerprint) {
        anyhow::bail!("local analysis payload does not match the recording identity");
    }
    let metadata = required_object(root, "metadata")?;
    let title = metadata
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if title.trim().is_empty() || title.chars().count() > 512 {
        anyhow::bail!("local analysis metadata title is invalid");
    }
    required_object(root, "beatGrid")?;
    if !root.get("analysisProvenance").is_some_and(Value::is_array) {
        anyhow::bail!("local analysis provenance is invalid");
    }
    let planning = required_object(root, "planningEvidence")?;
    if planning.get("version").and_then(Value::as_str) != Some(TRACK_PLANNING_EVIDENCE_VERSION)
        || planning.get("analyzerVersion").and_then(Value::as_str)
            != Some(TRACK_PLANNING_PROCESSOR_VERSION)
        || planning.get("recordingFingerprint").and_then(Value::as_str)
            != Some(expected_fingerprint)
    {
        anyhow::bail!("local planning evidence identity is invalid");
    }
    assert_path_free_value(payload, "analysisPayload")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_payload(fingerprint: &str) -> Value {
        json!({
            "version": TRACK_PLANNING_SCHEMA_VERSION,
            "analyzerVersion": TRACK_PLANNING_PROCESSOR_VERSION,
            "recordingFingerprint": fingerprint,
            "metadata": {"title": "Track"},
            "beatGrid": {},
            "analysisProvenance": [],
            "planningEvidence": {
                "version": TRACK_PLANNING_EVIDENCE_VERSION,
                "analyzerVersion": TRACK_PLANNING_PROCESSOR_VERSION,
                "recordingFingerprint": fingerprint,
                "descriptor": {},
                "musicMap": {}
            }
        })
    }

    #[test]
    fn planning_key_contains_every_cache_dimension() {
        let fingerprint = format!("sha256:{}", "a".repeat(64));
        let key = track_planning_artifact_key(&fingerprint).unwrap();
        key.validate().unwrap();
        assert_eq!(key.processor_id, TRACK_PLANNING_PROCESSOR_ID);
        assert_eq!(key.processor_version, TRACK_PLANNING_PROCESSOR_VERSION);
        assert_eq!(key.model_version, "atlas-ti-v4.0.0");
        assert_eq!(key.schema_version, TRACK_PLANNING_SCHEMA_VERSION);
    }

    #[test]
    fn payload_validation_fails_closed_on_identity_or_path_leak() {
        let fingerprint = format!("sha256:{}", "a".repeat(64));
        validate_track_planning_payload(&fingerprint, &valid_payload(&fingerprint)).unwrap();
        let mut wrong = valid_payload(&fingerprint);
        wrong["recordingFingerprint"] = Value::String(format!("sha256:{}", "b".repeat(64)));
        assert!(validate_track_planning_payload(&fingerprint, &wrong).is_err());
        let mut leaked = valid_payload(&fingerprint);
        leaked["metadata"]["filePath"] =
            Value::String("C:\\Users\\Example\\track.wav".to_string());
        assert!(validate_track_planning_payload(&fingerprint, &leaked).is_err());
    }
}
