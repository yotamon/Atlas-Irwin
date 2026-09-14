use crate::{db::BridgeDb, entitlements};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use url::Url;
use uuid::Uuid;

const MAX_MODEL_BYTES: u64 = 20 * 1024 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60 * 30);

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

fn safe_segment<'a>(value: &'a str, field: &str) -> anyhow::Result<&'a str> {
    if value.is_empty()
        || value.len() > 120
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
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

fn safe_https_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

fn validate_descriptor(descriptor: &ModelDescriptor) -> anyhow::Result<()> {
    safe_segment(&descriptor.id, "id")?;
    safe_segment(&descriptor.version, "version")?;
    if descriptor.platform != std::env::consts::OS
        || descriptor.architecture != std::env::consts::ARCH
    {
        anyhow::bail!("model artifact does not match this platform and architecture");
    }
    if descriptor.size_bytes == 0 || descriptor.size_bytes > MAX_MODEL_BYTES {
        anyhow::bail!("model artifact size is outside the safety budget");
    }
    if descriptor.sha256.len() != 71
        || !descriptor.sha256.starts_with("sha256:")
        || !descriptor.sha256[7..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        anyhow::bail!("model artifact checksum is invalid");
    }
    if descriptor
        .required_capability
        .as_ref()
        .is_some_and(|value| value.trim().is_empty())
    {
        anyhow::bail!("model required capability is invalid");
    }
    let url = Url::parse(&descriptor.url).context("model artifact URL is invalid")?;
    if !safe_https_url(&url) {
        anyhow::bail!("model artifact URL must be an HTTPS URL without embedded credentials");
    }
    Ok(())
}

fn assert_capability(
    db: &BridgeDb,
    device_id: Option<&str>,
    descriptor: &ModelDescriptor,
) -> anyhow::Result<()> {
    if let Some(capability) = descriptor.required_capability.as_deref() {
        if !entitlements::has_capability(db, device_id, capability) {
            anyhow::bail!("this model requires an unavailable desktop capability");
        }
    }
    Ok(())
}

fn installed_result(descriptor: &ModelDescriptor) -> InstalledModel {
    InstalledModel {
        id: descriptor.id.clone(),
        version: descriptor.version.clone(),
        sha256: descriptor.sha256.clone(),
        size_bytes: descriptor.size_bytes,
    }
}

fn already_installed(root: &Path, descriptor: &ModelDescriptor) -> anyhow::Result<bool> {
    let destination = artifact_path(root, descriptor)?;
    Ok(destination.is_file()
        && fs::metadata(&destination)?.len() == descriptor.size_bytes
        && sha256_file(&destination)? == descriptor.sha256)
}

pub fn install_model_from_catalog(
    db: &BridgeDb,
    device_id: Option<&str>,
    root: &Path,
    descriptor: &ModelDescriptor,
) -> anyhow::Result<InstalledModel> {
    validate_descriptor(descriptor)?;
    assert_capability(db, device_id, descriptor)?;
    if already_installed(root, descriptor)? {
        return Ok(installed_result(descriptor));
    }

    let destination = artifact_path(root, descriptor)?;
    let parent = destination
        .parent()
        .context("model destination has no parent")?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".download.{}.tmp", Uuid::new_v4()));
    let operation = (|| -> anyhow::Result<()> {
        let client = reqwest::blocking::Client::builder()
            .timeout(DOWNLOAD_TIMEOUT)
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 || !safe_https_url(attempt.url()) {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .build()?;
        let mut response = client
            .get(&descriptor.url)
            .send()
            .context("could not download the model artifact")?
            .error_for_status()
            .context("model artifact server returned an error")?;
        if !safe_https_url(response.url()) {
            anyhow::bail!("model artifact redirect resolved to an unsafe URL");
        }
        if let Some(length) = response.content_length() {
            if length != descriptor.size_bytes {
                anyhow::bail!("model artifact server reported an unexpected size");
            }
        }

        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        let mut hasher = Sha256::new();
        let mut written = 0u64;
        let mut buffer = [0u8; 1024 * 1024];
        loop {
            let read = response.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            written = written
                .checked_add(read as u64)
                .context("model artifact size overflow")?;
            if written > descriptor.size_bytes || written > MAX_MODEL_BYTES {
                anyhow::bail!("downloaded model artifact exceeded its declared size");
            }
            hasher.update(&buffer[..read]);
            output.write_all(&buffer[..read])?;
        }
        output.sync_all()?;
        drop(output);

        let checksum = format!("sha256:{}", hex::encode(hasher.finalize()));
        if written != descriptor.size_bytes || checksum != descriptor.sha256 {
            anyhow::bail!("downloaded model artifact failed size or checksum verification");
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
    Ok(installed_result(descriptor))
}

pub fn install_model_from_file(
    db: &BridgeDb,
    device_id: Option<&str>,
    root: &Path,
    descriptor: &ModelDescriptor,
    source: &Path,
) -> anyhow::Result<InstalledModel> {
    validate_descriptor(descriptor)?;
    assert_capability(db, device_id, descriptor)?;
    if !source.is_file() {
        anyhow::bail!("selected model artifact is unavailable");
    }
    let source_size = fs::metadata(source)?.len();
    if source_size != descriptor.size_bytes || sha256_file(source)? != descriptor.sha256 {
        anyhow::bail!("model artifact failed size or checksum verification");
    }
    if already_installed(root, descriptor)? {
        return Ok(installed_result(descriptor));
    }

    let destination = artifact_path(root, descriptor)?;
    let parent = destination
        .parent()
        .context("model destination has no parent")?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".artifact.{}.tmp", Uuid::new_v4()));
    let operation = (|| -> anyhow::Result<()> {
        let mut input = fs::File::open(source)?;
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
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
        if fs::metadata(&temporary)?.len() != descriptor.size_bytes
            || sha256_file(&temporary)? != descriptor.sha256
        {
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
    Ok(installed_result(descriptor))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_url_policy_requires_https_without_credentials() {
        assert!(safe_https_url(&Url::parse("https://models.example/artifact.bin").unwrap()));
        assert!(!safe_https_url(&Url::parse("http://models.example/artifact.bin").unwrap()));
        assert!(!safe_https_url(&Url::parse("https://user:secret@models.example/artifact.bin").unwrap()));
    }

    #[test]
    fn model_path_segments_reject_traversal() {
        assert!(safe_segment("atlas-ti", "id").is_ok());
        assert!(safe_segment("../private", "id").is_err());
        assert!(safe_segment("model/version", "version").is_err());
    }
}
