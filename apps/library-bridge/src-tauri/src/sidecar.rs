use crate::analysis::{
    AnalysisArtifactKey, TRACK_PLANNING_PROCESSOR_VERSION, TRACK_PLANNING_SCHEMA_VERSION,
    track_planning_artifact_key, validate_track_planning_payload,
};
use anyhow::Context;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use uuid::Uuid;

pub const ANALYSIS_BATCH_VERSION: &str = "ensemblis.library-bridge.analysis-batch.v1";
pub const RENDERER_VERSION: &str = "ensemblis.library-bridge.renderer.v1";
const SIDECAR_BASENAME: &str = "ensemblis-bridge-sidecar";
const MAX_ANALYSIS_BATCH: usize = 8;

#[derive(Debug, Clone)]
pub struct AnalysisInput {
    pub path: PathBuf,
    pub fingerprint: String,
}

#[derive(Debug, Clone)]
pub struct AnalysisResult {
    pub fingerprint: String,
    pub artifact_key: AnalysisArtifactKey,
    pub payload: Value,
}

pub fn sidecar_path_from_executable(executable: &Path) -> anyhow::Result<PathBuf> {
    let parent = executable
        .parent()
        .context("Library Bridge executable directory is unavailable")?;
    let filename = if cfg!(windows) {
        format!("{SIDECAR_BASENAME}.exe")
    } else {
        SIDECAR_BASENAME.to_string()
    };
    Ok(parent.join(filename))
}

pub fn bundled_sidecar_path() -> anyhow::Result<PathBuf> {
    sidecar_path_from_executable(&std::env::current_exe()?)
}

fn run(binary: &Path, args: &[&str]) -> anyhow::Result<()> {
    if !binary.is_file() {
        anyhow::bail!("local intelligence sidecar is unavailable");
    }
    let status = Command::new(binary)
        .args(args)
        .status()
        .context("could not start local intelligence sidecar")?;
    if !status.success() {
        anyhow::bail!("local intelligence sidecar failed");
    }
    Ok(())
}

fn work_directory(root: &Path, prefix: &str) -> anyhow::Result<PathBuf> {
    fs::create_dir_all(root)?;
    let directory = root.join(format!("{prefix}-{}", Uuid::new_v4()));
    fs::create_dir(&directory)?;
    Ok(directory)
}

pub fn analyze_batch(
    binary: &Path,
    work_root: &Path,
    inputs: &[AnalysisInput],
) -> anyhow::Result<Vec<AnalysisResult>> {
    if inputs.is_empty() || inputs.len() > MAX_ANALYSIS_BATCH {
        anyhow::bail!("local analysis batch must contain 1-8 tracks");
    }
    let mut seen = HashSet::new();
    for input in inputs {
        track_planning_artifact_key(&input.fingerprint)?;
        if !input.path.is_file() || !seen.insert(input.fingerprint.as_str()) {
            anyhow::bail!("local analysis batch contains an invalid recording");
        }
    }

    let directory = work_directory(work_root, "analysis")?;
    let request_path = directory.join("request.json");
    let result_path = directory.join("result.json");
    let operation = (|| -> anyhow::Result<Vec<AnalysisResult>> {
        let request = json!({
            "version": ANALYSIS_BATCH_VERSION,
            "tracks": inputs.iter().map(|input| json!({
                "source": input.path,
                "fingerprint": input.fingerprint,
            })).collect::<Vec<_>>(),
        });
        fs::write(&request_path, serde_json::to_vec(&request)?)?;
        let request_arg = request_path.to_string_lossy().into_owned();
        let result_arg = result_path.to_string_lossy().into_owned();
        run(
            binary,
            &[
                "analyze-batch",
                "--request",
                &request_arg,
                "--result",
                &result_arg,
            ],
        )?;

        let output: Value = serde_json::from_slice(&fs::read(&result_path)?)?;
        if output.get("version").and_then(Value::as_str) != Some(ANALYSIS_BATCH_VERSION) {
            anyhow::bail!("local analysis sidecar returned an unsupported contract");
        }
        if output.get("analyzerVersion").and_then(Value::as_str)
            != Some(TRACK_PLANNING_PROCESSOR_VERSION)
        {
            anyhow::bail!("local analysis sidecar processor version does not match the registry");
        }
        if output.get("analysisPayloadVersion").and_then(Value::as_str)
            != Some(TRACK_PLANNING_SCHEMA_VERSION)
        {
            anyhow::bail!("local analysis sidecar payload schema does not match the registry");
        }
        let rows = output
            .get("tracks")
            .and_then(Value::as_array)
            .context("local analysis sidecar returned invalid results")?;
        let expected: HashSet<&str> = inputs
            .iter()
            .map(|input| input.fingerprint.as_str())
            .collect();
        let mut returned = HashSet::new();
        let mut results = Vec::new();
        for row in rows {
            let fingerprint = row
                .get("fingerprint")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !expected.contains(fingerprint) || !returned.insert(fingerprint) {
                anyhow::bail!("local analysis sidecar returned an unexpected recording identity");
            }
            if row.get("status").and_then(Value::as_str) != Some("completed") {
                continue;
            }
            let payload = row
                .get("result")
                .cloned()
                .filter(Value::is_object)
                .context("local analysis sidecar returned an invalid completed payload")?;
            validate_track_planning_payload(fingerprint, &payload)?;
            results.push(AnalysisResult {
                fingerprint: fingerprint.to_string(),
                artifact_key: track_planning_artifact_key(fingerprint)?,
                payload,
            });
        }
        Ok(results)
    })();
    let _ = fs::remove_dir_all(&directory);
    operation
}

pub fn render(binary: &Path, work_root: &Path, request: &Value) -> anyhow::Result<Value> {
    if request.get("version").and_then(Value::as_str) != Some(RENDERER_VERSION) {
        anyhow::bail!("local render request uses an unsupported contract");
    }
    let directory = work_directory(work_root, "render")?;
    let request_path = directory.join("request.json");
    let result_path = directory.join("result.json");
    let operation = (|| -> anyhow::Result<Value> {
        fs::write(&request_path, serde_json::to_vec(request)?)?;
        let request_arg = request_path.to_string_lossy().into_owned();
        let result_arg = result_path.to_string_lossy().into_owned();
        run(
            binary,
            &["render", "--request", &request_arg, "--result", &result_arg],
        )?;
        let output: Value = serde_json::from_slice(&fs::read(&result_path)?)?;
        if output.get("version").and_then(Value::as_str) != Some(RENDERER_VERSION)
            || output.get("status").and_then(Value::as_str) != Some("completed")
        {
            anyhow::bail!("local renderer returned an invalid result");
        }
        Ok(output)
    })();
    // Do not remove a successful render directory here: the sidecar output asset intentionally lives
    // inside it. The caller owns moving/exporting the finished local file and cleanup afterwards.
    if operation.is_err() {
        let _ = fs::remove_dir_all(&directory);
    }
    operation
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_sidecar_sits_next_to_the_trusted_executable() {
        let executable = if cfg!(windows) {
            PathBuf::from(r"C:\Program Files\Ensemblis\ensemblis-library-bridge.exe")
        } else {
            PathBuf::from("/Applications/Ensemblis.app/Contents/MacOS/ensemblis-library-bridge")
        };
        let path = sidecar_path_from_executable(&executable).unwrap();
        assert_eq!(path.parent(), executable.parent());
        assert!(
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(SIDECAR_BASENAME)
        );
    }
}
