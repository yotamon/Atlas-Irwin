use anyhow::Context;
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

const RENDERER_VERSION: &str = "ensemblis.library-bridge.renderer.v1";

#[derive(Debug, Clone)]
pub struct LocalRenderAsset {
    pub source_path: PathBuf,
    pub output_format: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedRender {
    pub file_name: String,
    pub saved_to: String,
    pub sha256: String,
}

fn render_result(directory: &Path) -> anyhow::Result<Option<(SystemTime, LocalRenderAsset)>> {
    let result_path = directory.join("result.json");
    if !result_path.is_file() {
        return Ok(None);
    }
    let modified = result_path
        .metadata()?
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let value: Value = serde_json::from_slice(&fs::read(&result_path)?)?;
    if value.get("version").and_then(Value::as_str) != Some(RENDERER_VERSION)
        || value.get("status").and_then(Value::as_str) != Some("completed")
    {
        return Ok(None);
    }
    let output_format = value
        .get("outputFormat")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "wav" | "mp3"))
        .context("completed local render has an invalid output format")?
        .to_string();
    let sha256 = value
        .get("sha256")
        .and_then(Value::as_str)
        .filter(|value| value.starts_with("sha256:") && value.len() == 71)
        .context("completed local render has an invalid fingerprint")?
        .to_string();
    let raw_output = value
        .get("outputPath")
        .and_then(Value::as_str)
        .context("completed local render omitted its local output")?;
    let output = PathBuf::from(raw_output).canonicalize()?;
    let trusted_directory = directory.canonicalize()?;
    if !output.starts_with(&trusted_directory) || !output.is_file() {
        anyhow::bail!("completed local render points outside the trusted render workspace");
    }
    Ok(Some((
        modified,
        LocalRenderAsset {
            source_path: output,
            output_format,
            sha256,
        },
    )))
}

pub fn latest_completed_render(work_root: &Path) -> anyhow::Result<Option<LocalRenderAsset>> {
    if !work_root.is_dir() {
        return Ok(None);
    }
    let mut latest: Option<(SystemTime, LocalRenderAsset)> = None;
    for entry in fs::read_dir(work_root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir()
            || !entry.file_name().to_string_lossy().starts_with("render-")
        {
            continue;
        }
        let Some(candidate) = render_result(&entry.path())? else {
            continue;
        };
        if latest
            .as_ref()
            .is_none_or(|current| candidate.0 > current.0)
        {
            latest = Some(candidate);
        }
    }
    Ok(latest.map(|(_, asset)| asset))
}

pub fn export_render(
    asset: &LocalRenderAsset,
    destination_directory: &Path,
) -> anyhow::Result<ExportedRender> {
    if !destination_directory.is_dir() {
        anyhow::bail!("export destination is unavailable");
    }
    let hash_suffix = asset
        .sha256
        .strip_prefix("sha256:")
        .unwrap_or(&asset.sha256)
        .chars()
        .take(10)
        .collect::<String>();
    let file_name = format!("Ensemblis-Mix-{hash_suffix}.{}", asset.output_format);
    let target = destination_directory.join(&file_name);
    fs::copy(&asset.source_path, &target)?;
    Ok(ExportedRender {
        file_name,
        saved_to: target.to_string_lossy().to_string(),
        sha256: asset.sha256.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn latest_render_never_accepts_output_outside_trusted_workspace() {
        let directory = tempdir().unwrap();
        let render = directory.path().join("render-one");
        fs::create_dir(&render).unwrap();
        let outside = directory.path().join("outside.wav");
        fs::write(&outside, b"audio").unwrap();
        fs::write(
            render.join("result.json"),
            serde_json::to_vec(&serde_json::json!({
                "version": RENDERER_VERSION,
                "status": "completed",
                "outputFormat": "wav",
                "outputPath": outside,
                "sha256": format!("sha256:{}", "a".repeat(64))
            }))
            .unwrap(),
        )
        .unwrap();
        assert!(latest_completed_render(directory.path()).is_err());
    }

    #[test]
    fn completed_render_can_be_exported_without_touching_source() {
        let directory = tempdir().unwrap();
        let render = directory.path().join("render-one");
        let export = directory.path().join("export");
        fs::create_dir(&render).unwrap();
        fs::create_dir(&export).unwrap();
        let mix = render.join("mix.wav");
        fs::write(&mix, b"mix-bytes").unwrap();
        fs::write(
            render.join("result.json"),
            serde_json::to_vec(&serde_json::json!({
                "version": RENDERER_VERSION,
                "status": "completed",
                "outputFormat": "wav",
                "outputPath": mix,
                "sha256": format!("sha256:{}", "b".repeat(64))
            }))
            .unwrap(),
        )
        .unwrap();
        let asset = latest_completed_render(directory.path()).unwrap().unwrap();
        let result = export_render(&asset, &export).unwrap();
        assert_eq!(
            fs::read(export.join(result.file_name)).unwrap(),
            b"mix-bytes"
        );
        assert_eq!(fs::read(mix).unwrap(), b"mix-bytes");
    }
}
