use crate::{
    db::BridgeDb,
    identity::fingerprint_file,
    privacy::{assert_path_free_value, assert_recording_fingerprint},
};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

pub const PROJECT_FORMAT_VERSION: &str = "ensemblis.project.v1";
const MANIFEST_NAME: &str = "project.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaPolicy {
    Reference,
    ManagedCopy,
    CloudOptional,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectRecording {
    pub id: String,
    pub fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_policy: Option<MediaPolicy>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectAnalysisArtifact {
    pub artifact_id: String,
    pub recording_fingerprint: String,
    pub processor_id: String,
    pub schema_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectAsset {
    pub id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recording_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectManifest {
    pub version: String,
    pub project_id: String,
    pub title: String,
    pub revision: u64,
    pub recordings: Vec<ProjectRecording>,
    pub analysis_artifacts: Vec<ProjectAnalysisArtifact>,
    pub assets: Vec<ProjectAsset>,
    pub updated_at: String,
}

fn current_timestamp() -> anyhow::Result<String> {
    Ok(OffsetDateTime::now_utc().format(&Rfc3339)?)
}

fn is_ensemble_package(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("ensemble"))
}

fn validate_non_empty(value: &str, field: &str) -> anyhow::Result<()> {
    if value.trim().is_empty() {
        anyhow::bail!("portable project {field} is required");
    }
    Ok(())
}

pub fn validate_manifest(manifest: &ProjectManifest) -> anyhow::Result<()> {
    if manifest.version != PROJECT_FORMAT_VERSION {
        anyhow::bail!("unsupported Ensemblis project format");
    }
    validate_non_empty(&manifest.project_id, "projectId")?;
    validate_non_empty(&manifest.title, "title")?;
    OffsetDateTime::parse(&manifest.updated_at, &Rfc3339)
        .context("portable project updatedAt is not valid RFC 3339")?;

    let mut recording_ids = HashSet::new();
    for recording in &manifest.recordings {
        validate_non_empty(&recording.id, "recording id")?;
        if !recording_ids.insert(recording.id.as_str()) {
            anyhow::bail!("portable project contains duplicate recording ids");
        }
        assert_recording_fingerprint(&recording.fingerprint, "recording fingerprint")?;
    }

    let mut artifact_ids = HashSet::new();
    for artifact in &manifest.analysis_artifacts {
        validate_non_empty(&artifact.artifact_id, "analysis artifact id")?;
        if !artifact_ids.insert(artifact.artifact_id.as_str()) {
            anyhow::bail!("portable project contains duplicate analysis artifact ids");
        }
        validate_non_empty(&artifact.processor_id, "analysis processor id")?;
        validate_non_empty(&artifact.schema_version, "analysis schema version")?;
        assert_recording_fingerprint(
            &artifact.recording_fingerprint,
            "analysis recording fingerprint",
        )?;
    }

    let mut asset_ids = HashSet::new();
    for asset in &manifest.assets {
        validate_non_empty(&asset.id, "asset id")?;
        if !asset_ids.insert(asset.id.as_str()) {
            anyhow::bail!("portable project contains duplicate asset ids");
        }
        validate_non_empty(&asset.kind, "asset kind")?;
        if let Some(fingerprint) = &asset.recording_fingerprint {
            assert_recording_fingerprint(fingerprint, "asset recording fingerprint")?;
        }
    }

    assert_path_free_value(&serde_json::to_value(manifest)?, "project")?;
    Ok(())
}

fn project_manifest_path(package: &Path) -> PathBuf {
    package.join(MANIFEST_NAME)
}

pub fn read_manifest(package: &Path) -> anyhow::Result<ProjectManifest> {
    if !is_ensemble_package(package) {
        anyhow::bail!("Ensemblis project packages must end in .ensemble");
    }
    let manifest_path = project_manifest_path(package);
    let manifest: ProjectManifest = serde_json::from_slice(
        &fs::read(&manifest_path)
            .with_context(|| format!("could not read {}", manifest_path.display()))?,
    )?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

#[cfg(windows)]
fn replace_file_atomic(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let existing = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let new = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            existing.as_ptr(),
            new.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file_atomic(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

pub fn write_manifest(package: &Path, manifest: &ProjectManifest) -> anyhow::Result<()> {
    if !is_ensemble_package(package) {
        anyhow::bail!("Ensemblis project packages must end in .ensemble");
    }
    validate_manifest(manifest)?;
    fs::create_dir_all(package)?;
    for directory in ["media", "analysis", "assets", "exports", "cache"] {
        fs::create_dir_all(package.join(directory))?;
    }

    let manifest_path = project_manifest_path(package);
    let temporary = package.join(format!(".{MANIFEST_NAME}.{}.tmp", Uuid::new_v4()));
    let operation = (|| -> anyhow::Result<()> {
        let bytes = serde_json::to_vec_pretty(manifest)?;
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        drop(file);
        replace_file_atomic(&temporary, &manifest_path)?;
        #[cfg(unix)]
        std::fs::File::open(package)?.sync_all()?;
        Ok(())
    })();
    if operation.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    operation
}

pub fn package_name(title: &str) -> String {
    let cleaned = title
        .trim()
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, ' ' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    let stem = if cleaned.is_empty() {
        "Untitled"
    } else {
        cleaned
    };
    format!("{stem}.ensemble")
}

pub fn create_project(package: &Path, title: &str) -> anyhow::Result<ProjectManifest> {
    if !is_ensemble_package(package) {
        anyhow::bail!("Ensemblis project packages must end in .ensemble");
    }
    if package.exists() {
        anyhow::bail!("project package already exists");
    }
    let title = title.trim();
    if title.is_empty() {
        anyhow::bail!("project title is required");
    }
    let manifest = ProjectManifest {
        version: PROJECT_FORMAT_VERSION.to_string(),
        project_id: format!("prj_{}", Uuid::new_v4()),
        title: title.to_string(),
        revision: 0,
        recordings: Vec::new(),
        analysis_artifacts: Vec::new(),
        assets: Vec::new(),
        updated_at: current_timestamp()?,
    };
    write_manifest(package, &manifest)?;
    Ok(manifest)
}

pub fn register_project(
    db: &BridgeDb,
    package: &Path,
    manifest: &ProjectManifest,
) -> anyhow::Result<()> {
    validate_manifest(manifest)?;
    db.register_project(
        &manifest.project_id,
        package,
        &manifest.version,
        manifest.revision,
    )
}

pub fn save_registered_project(
    db: &BridgeDb,
    proposed: ProjectManifest,
) -> anyhow::Result<ProjectManifest> {
    validate_manifest(&proposed)?;
    let package = db
        .project_package_path(&proposed.project_id)?
        .context("project is not registered on this device")?;
    let current = read_manifest(&package)?;
    if current.project_id != proposed.project_id || current.version != proposed.version {
        anyhow::bail!("project identity does not match the registered package");
    }
    if proposed.revision != current.revision {
        anyhow::bail!("project revision is stale; reopen the project before saving");
    }

    let mut normalized = proposed.clone();
    normalized.updated_at = current.updated_at.clone();
    if normalized == current {
        return Ok(current);
    }
    normalized.revision = current
        .revision
        .checked_add(1)
        .context("project revision overflow")?;
    normalized.updated_at = current_timestamp()?;
    validate_manifest(&normalized)?;
    write_manifest(&package, &normalized)?;
    db.register_project(
        &normalized.project_id,
        &package,
        &normalized.version,
        normalized.revision,
    )?;
    Ok(normalized)
}

pub fn bind_recording(
    db: &BridgeDb,
    package: &Path,
    recording_id: &str,
    path: &Path,
) -> anyhow::Result<ProjectRecording> {
    validate_non_empty(recording_id, "recording id")?;
    if !path.is_file() {
        anyhow::bail!("selected recording is unavailable");
    }
    let mut manifest = read_manifest(package)?;
    let fingerprint = fingerprint_file(path)?;
    let recording = ProjectRecording {
        id: recording_id.to_string(),
        fingerprint: fingerprint.clone(),
        display_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .map(ToOwned::to_owned),
        media_policy: Some(MediaPolicy::Reference),
    };
    manifest.recordings.retain(|item| item.id != recording_id);
    manifest.recordings.push(recording.clone());
    manifest.revision = manifest
        .revision
        .checked_add(1)
        .context("project revision overflow")?;
    manifest.updated_at = current_timestamp()?;
    write_manifest(package, &manifest)?;
    db.register_project(
        &manifest.project_id,
        package,
        &manifest.version,
        manifest.revision,
    )?;
    db.bind_project_recording(&manifest.project_id, recording_id, &fingerprint, path)?;
    Ok(recording)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn portable_manifest_round_trips_without_a_path() {
        let directory = tempdir().unwrap();
        let package = directory.path().join("Demo.ensemble");
        let manifest = create_project(&package, "Demo").unwrap();
        let loaded = read_manifest(&package).unwrap();
        assert_eq!(loaded, manifest);
        let serialized = serde_json::to_string(&loaded).unwrap();
        assert!(!serialized.contains(directory.path().to_string_lossy().as_ref()));
        assert!(package.join("project.json").is_file());
    }

    #[test]
    fn portable_manifest_rejects_unknown_or_local_fields() {
        let fingerprint = format!("sha256:{}", "a".repeat(64));
        let invalid: Result<ProjectManifest, _> = serde_json::from_value(serde_json::json!({
            "version": PROJECT_FORMAT_VERSION,
            "projectId": "prj_test",
            "title": "Test",
            "revision": 0,
            "recordings": [{
                "id": "r1",
                "fingerprint": fingerprint,
                "path": "/Users/example/private.wav"
            }],
            "analysisArtifacts": [],
            "assets": [],
            "updatedAt": "2026-09-12T01:00:00Z"
        }));
        assert!(invalid.is_err());
    }

    #[test]
    fn rfc3339_validation_checks_calendar_and_zone() {
        assert!(OffsetDateTime::parse("2026-09-12T01:02:03Z", &Rfc3339).is_ok());
        assert!(OffsetDateTime::parse("2026-09-12T01:02:03.123+02:00", &Rfc3339).is_ok());
        assert!(OffsetDateTime::parse("2026-02-30T01:02:03Z", &Rfc3339).is_err());
    }
}
