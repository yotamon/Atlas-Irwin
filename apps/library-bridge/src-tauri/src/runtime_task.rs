use crate::{
    analysis::{
        TRACK_PLANNING_MODEL_ID, TRACK_PLANNING_MODEL_VERSION, TRACK_PLANNING_PARAMETERS_HASH,
        TRACK_PLANNING_PROCESSOR_ID, TRACK_PLANNING_PROCESSOR_VERSION,
        TRACK_PLANNING_SCHEMA_VERSION, track_planning_artifact_key,
    },
    db::BridgeDb,
    identity::{fingerprint_file, hash_text},
    privacy::assert_path_free_value,
    sidecar::{self, AnalysisInput},
};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

pub const RUNTIME_TASK_VERSION: &str = "ensemblis.runtime-task.v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeTaskProcessor {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeTaskReference {
    pub kind: String,
    pub id: String,
    pub recording_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeTaskExecution {
    pub policy: Value,
    pub requested_target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeTask {
    pub version: String,
    pub id: String,
    pub idempotency_key: String,
    pub processor: RuntimeTaskProcessor,
    pub input_references: Vec<RuntimeTaskReference>,
    pub payload: Value,
    pub execution: RuntimeTaskExecution,
    pub context: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalRuntimeTaskResult {
    pub status: String,
    pub task_id: String,
    pub artifact: Value,
    pub payload: Value,
}

fn expected_fingerprint(task: &RuntimeTask) -> anyhow::Result<&str> {
    task.input_references
        .iter()
        .find(|reference| reference.kind == "recording")
        .and_then(|reference| reference.recording_fingerprint.as_deref())
        .filter(|value| !value.is_empty())
        .context("local RuntimeTask is missing its recording fingerprint")
}

pub fn validate_local_task(task: &RuntimeTask) -> anyhow::Result<()> {
    if task.version != RUNTIME_TASK_VERSION
        || task.id.trim().is_empty()
        || task.idempotency_key.trim().is_empty()
    {
        anyhow::bail!("local RuntimeTask identity is invalid");
    }
    if task.processor.id != TRACK_PLANNING_PROCESSOR_ID
        || task.processor.version != TRACK_PLANNING_PROCESSOR_VERSION
    {
        anyhow::bail!("local RuntimeTask processor is unsupported");
    }
    if task.execution.requested_target.as_deref() != Some("local_sidecar") {
        anyhow::bail!("local RuntimeTask was not routed to local_sidecar");
    }
    let fingerprint = expected_fingerprint(task)?;
    track_planning_artifact_key(fingerprint)?;
    assert_path_free_value(&serde_json::to_value(task)?, "runtimeTask")?;
    Ok(())
}

fn public_artifact(fingerprint: &str) -> Value {
    let identity = format!(
        "{fingerprint}|{TRACK_PLANNING_PROCESSOR_ID}|{TRACK_PLANNING_PROCESSOR_VERSION}|{TRACK_PLANNING_MODEL_ID}|{TRACK_PLANNING_MODEL_VERSION}|{TRACK_PLANNING_SCHEMA_VERSION}|{TRACK_PLANNING_PARAMETERS_HASH}",
    );
    let artifact_hash = hash_text(&identity).trim_start_matches("sha256:").to_string();
    serde_json::json!({
        "artifactId": format!("art_{}", &artifact_hash[..32]),
        "recordingFingerprint": fingerprint,
        "processorId": TRACK_PLANNING_PROCESSOR_ID,
        "processorVersion": TRACK_PLANNING_PROCESSOR_VERSION,
        "modelId": TRACK_PLANNING_MODEL_ID,
        "modelVersion": TRACK_PLANNING_MODEL_VERSION,
        "schemaVersion": TRACK_PLANNING_SCHEMA_VERSION,
        "parametersHash": TRACK_PLANNING_PARAMETERS_HASH,
    })
}

pub fn execute_track_planning_task(
    db: &BridgeDb,
    sidecar_binary: &Path,
    work_root: &Path,
    source: &Path,
    task: &RuntimeTask,
) -> anyhow::Result<LocalRuntimeTaskResult> {
    validate_local_task(task)?;
    if !sidecar_binary.is_file() || !source.is_file() {
        anyhow::bail!("local RuntimeTask source or processor is unavailable");
    }
    let fingerprint = expected_fingerprint(task)?;
    let actual = fingerprint_file(source)?;
    if actual != fingerprint {
        anyhow::bail!("selected local bytes do not match the frozen recording identity");
    }
    let key = track_planning_artifact_key(fingerprint)?;
    let payload = match db.cached_analysis_artifact(&key)? {
        Some(cached) => cached,
        None => {
            let mut results = sidecar::analyze_batch(
                sidecar_binary,
                work_root,
                &[AnalysisInput {
                    path: source.to_path_buf(),
                    fingerprint: fingerprint.to_string(),
                }],
            )?;
            let result = results
                .pop()
                .context("local analyzer did not return completed evidence")?;
            db.store_analysis_artifact(&result.artifact_key, &result.payload)?;
            result.payload
        }
    };
    let result = LocalRuntimeTaskResult {
        status: "completed".to_string(),
        task_id: task.id.clone(),
        artifact: public_artifact(fingerprint),
        payload,
    };
    assert_path_free_value(&serde_json::to_value(&result)?, "runtimeTaskResult")?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_task_requires_explicit_local_router_target() {
        let fingerprint = format!("sha256:{}", "a".repeat(64));
        let task = RuntimeTask {
            version: RUNTIME_TASK_VERSION.to_string(),
            id: "task_1".to_string(),
            idempotency_key: "idem_1".to_string(),
            processor: RuntimeTaskProcessor {
                id: TRACK_PLANNING_PROCESSOR_ID.to_string(),
                version: TRACK_PLANNING_PROCESSOR_VERSION.to_string(),
            },
            input_references: vec![RuntimeTaskReference {
                kind: "recording".to_string(),
                id: "rec_1".to_string(),
                recording_fingerprint: Some(fingerprint),
            }],
            payload: serde_json::json!({}),
            execution: RuntimeTaskExecution {
                policy: serde_json::json!({
                    "version": "ensemblis.execution-policy.v1",
                    "preference": "automatic",
                    "neverUploadAudio": false,
                    "allowPaidCompute": true,
                    "cloudFallback": true
                }),
                requested_target: Some("cloud".to_string()),
            },
            context: None,
        };
        assert!(validate_local_task(&task).is_err());
    }
}
