use crate::{
    db::BridgeDb,
    entitlements::{EntitlementPublicKey, SignedEntitlementClaims, store_pairing_entitlement},
};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

pub const DESKTOP_LICENSE_FILE_VERSION: &str = "ensemblis.desktop-license-file.v1";
const MAX_LICENSE_FILE_BYTES: u64 = 128 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopLicenseFile {
    pub version: String,
    pub public_key: EntitlementPublicKey,
    pub token: String,
}

pub fn import_license_file(
    db: &BridgeDb,
    path: &Path,
    expected_device_id: &str,
) -> anyhow::Result<SignedEntitlementClaims> {
    let metadata = fs::metadata(path).context("could not inspect desktop license file")?;
    if !metadata.is_file() || metadata.len() > MAX_LICENSE_FILE_BYTES {
        anyhow::bail!("desktop license file is invalid or too large");
    }
    let license: DesktopLicenseFile = serde_json::from_slice(&fs::read(path)?)?;
    if license.version != DESKTOP_LICENSE_FILE_VERSION {
        anyhow::bail!("desktop license file version is unsupported");
    }
    store_pairing_entitlement(db, &license.public_key, &license.token, expected_device_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn license_file_contract_rejects_unknown_fields() {
        let parsed: Result<DesktopLicenseFile, _> = serde_json::from_value(serde_json::json!({
            "version": DESKTOP_LICENSE_FILE_VERSION,
            "publicKey": {
                "algorithm": "Ed25519",
                "keyId": "example",
                "publicKeySpkiBase64": "AA=="
            },
            "token": "a.b.c",
            "filePath": "/tmp/license"
        }));
        assert!(parsed.is_err());
    }
}
