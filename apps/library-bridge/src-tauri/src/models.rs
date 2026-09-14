use crate::{db::BridgeDb, entitlements};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

const MAX_MODEL_BYTES: u64 = 20 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelDescriptor {
    pub id: String,
    pub version: String,
    pub platform: String,
    pub architecture: String,
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub required_capability: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModel {
    pub id: String,
    pub version: String,
    pub sha256: String,
    pub size_bytes: u64,
}

fn safe_segment(value: &str, field: &str) -> anyhow::Result<&str> {
    if value.is_empty()
        || value.len() > 120
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-'))
    {
        anyhow::bail!("model {field} is invalid");
    }
    Ok(value)
}

fn artifact_path(root: &Path, descriptor: &ModelDescriptor) -> anyhow::Result<PathBuf> {
    Ok(root
        .join(safe_segment(&descriptor.id, "id")?)
        .join(safe_segment(&descriptor.version, "version")?)
        .join("artifact.bin"))
}

fn sha256_file(path: &Path) -> anyhow::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

fn validate_descriptor(descriptor: &ModelDescriptor) -> anyhow::Result<()> {
    safe_segment(&descriptor.id, "id")?;
    safe_segment(&descriptor.version, "version")?;
    if descriptor.platform != std::env::consts::OS || descriptor.architecture != std::env::consts::ARCH {
        anyhow::bail!("model artifact does not match this platform and architecture");
    }
    if descriptor.size_bytes == 0 || descriptor.size_bytes > MAX_MODEL_BYTES {
        anyhow::bail!("model artifact size is outside the safety budget");
    }
    if descriptor.sha256.len() != 71
        || !descriptor.sha256.starts_with("sha256:")
        || !descriptor.sha256[7..].chars().all(|character| character.is_ascii_hexdigit())
    {
        anyhow::bail!("model artifact checksum is invalid");
    }
    if descriptor.required_capability.as_ref().is_some_and(|value| value.trim().is_empty()) {
        anyhow::bail!("model required capability is invalid");
    }
    Ok(())
}

pub fn install_model_from_file(
    db: &BridgeDb,
    device_id: Option<&str>,
    root: &Path,
    descriptor: &ModelDescriptor,
    source: &Path,
) -> anyhow::Result<InstalledModel> {
    validate_descriptor(descriptor)?;
    if let Some(capability) = descriptor.required_capability.as_deref() {
        if !entitlements::has_capability(db, device_id, capability) {
            anyhow::bail!("this model requires an unavailable desktop capability");
        }
    }
    if !source.is_file() {
        anyhow::bail!("selected model artifact is unavailable");
    }
    let source_size = fs::metadata(source)?.len();
    if source_size != descriptor.size_bytes || sha256_file(source)? != descriptor.sha256 {
        anyhow::bail!("model artifact failed size or checksum verification");
    }

    let destination = artifact_path(root, descriptor)?;
    if destination.is_file()
        && fs::metadata(&destination)?.len() == descriptor.size_bytes
        && sha256_file(&destination)? == descriptor.sha256
    {
        return Ok(InstalledModel {
            id: descriptor.id.clone(),
            version: descriptor.version.clone(),
            sha256: descriptor.sha256.clone(),
            size_bytes: descriptor.size_bytes,
        });
    }

    let parent = destination.parent().context("model destination has no parent")?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".artifact.{}.tmp", Uuid::new_v4()));
    let operation = (|| -> anyhow::Result<()> {
        let mut input = fs::File::open(source)?;
        let mut output = OpenOptions::new().create_new(true).write(true).open(&temporary)?;
        let mut buffer = [0u8; 1024 * 1024];
        loop {
            let read = input.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            output.write_all(&buffer[..read])?;
        }
        output.sync_all()?;
        drop(output);
        if fs::metadata(&temporary)?.len() != descriptor.size_bytes || sha256_file(&temporary)? != descriptor.sha256 {
            anyhow::bail!("copied model artifact failed verification");
        }
        if destination.exists() {
            fs::remove_file(&destination)?;
        }
        fs::rename(&temporary, &destination)?;
        #[cfg(unix)]
        fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if operation.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    operation?;
    Ok(InstalledModel {
        id: descriptor.id.clone(),
        version: descriptor.version.clone(),
        sha256: descriptor.sha256.clone(),
        size_bytes: descriptor.size_bytes,
    })
}

pub fn uninstall_model(root: &Path, id: &str, version: &str) -> anyhow::Result<bool> {
    safe_segment(id, "id")?;
    safe_segment(version, "version")?;
    let directory = root.join(id).join(version);
    if !directory.exists() {
        return Ok(false);
    }
    fs::remove_dir_all(directory)?;
    Ok(true)
}
