use crate::db::BridgeDb;
use anyhow::Context;
use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use ed25519_dalek::{Signature, Verifier, VerifyingKey, pkcs8::DecodePublicKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub const SIGNED_ENTITLEMENT_CLAIMS_VERSION: &str = "ensemblis.signed-entitlement-claims.v1";
const TOKEN_SETTING: &str = "desktop_entitlement_token_v1";
const PUBLIC_KEY_SETTING: &str = "desktop_entitlement_public_key_spki_v1";
const KEY_ID_SETTING: &str = "desktop_entitlement_key_id_v1";
const MAX_TOKEN_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntitlementPublicKey {
    pub algorithm: String,
    pub key_id: String,
    pub public_key_spki_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LicenseClaim {
    pub kind: Option<String>,
    pub major_version: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedEntitlementClaims {
    pub version: String,
    pub subject_id: String,
    pub device_id: String,
    pub capabilities: Vec<String>,
    pub offline_capabilities: Vec<String>,
    pub issued_at: String,
    pub expires_at: String,
    pub offline_grace_until: String,
    pub license: LicenseClaim,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveEntitlement {
    pub mode: String,
    pub capabilities: Vec<String>,
    pub expires_at: Option<String>,
    pub offline_grace_until: Option<String>,
    pub license_kind: Option<String>,
    pub major_version: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct TokenHeader {
    alg: String,
    typ: String,
    kid: String,
}

fn key_id(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))[..24].to_string()
}

fn parse_time(value: &str, field: &str) -> anyhow::Result<OffsetDateTime> {
    OffsetDateTime::parse(value, &Rfc3339)
        .with_context(|| format!("signed entitlement {field} is invalid"))
}

fn decode_public_key(encoded: &str) -> anyhow::Result<(Vec<u8>, VerifyingKey)> {
    let bytes = STANDARD
        .decode(encoded)
        .context("signed entitlement public key is invalid base64")?;
    if bytes.len() > 256 {
        anyhow::bail!("signed entitlement public key is oversized");
    }
    let key = VerifyingKey::from_public_key_der(&bytes)
        .context("signed entitlement public key is not Ed25519 SPKI")?;
    Ok((bytes, key))
}

pub fn verify_token(
    token: &str,
    public_key_spki_base64: &str,
    expected_device_id: &str,
) -> anyhow::Result<SignedEntitlementClaims> {
    if token.len() > MAX_TOKEN_BYTES {
        anyhow::bail!("signed entitlement token is oversized");
    }
    let parts = token.split('.').collect::<Vec<_>>();
    if parts.len() != 3 || parts.iter().any(|part| part.is_empty()) {
        anyhow::bail!("signed entitlement token format is invalid");
    }
    let header_bytes = URL_SAFE_NO_PAD
        .decode(parts[0])
        .context("signed entitlement header is invalid")?;
    let payload_bytes = URL_SAFE_NO_PAD
        .decode(parts[1])
        .context("signed entitlement payload is invalid")?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(parts[2])
        .context("signed entitlement signature is invalid")?;
    let header: TokenHeader = serde_json::from_slice(&header_bytes)?;
    if header.alg != "EdDSA" || header.typ != "ENSEMBLIS-ENTITLEMENT" {
        anyhow::bail!("signed entitlement header is unsupported");
    }
    let (public_der, verifier) = decode_public_key(public_key_spki_base64)?;
    if header.kid != key_id(&public_der) {
        anyhow::bail!("signed entitlement key id does not match the pinned key");
    }
    let signature = Signature::from_slice(&signature_bytes)
        .context("signed entitlement signature length is invalid")?;
    verifier
        .verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
        .context("signed entitlement signature verification failed")?;
    let claims: SignedEntitlementClaims = serde_json::from_slice(&payload_bytes)?;
    if claims.version != SIGNED_ENTITLEMENT_CLAIMS_VERSION || claims.device_id != expected_device_id
    {
        anyhow::bail!("signed entitlement identity is invalid");
    }
    if claims.subject_id.trim().is_empty()
        || claims.capabilities.len() > 128
        || claims.offline_capabilities.len() > 128
    {
        anyhow::bail!("signed entitlement claims exceed safety limits");
    }
    let issued = parse_time(&claims.issued_at, "issuedAt")?;
    let expires = parse_time(&claims.expires_at, "expiresAt")?;
    let grace = parse_time(&claims.offline_grace_until, "offlineGraceUntil")?;
    if expires < issued || grace < expires {
        anyhow::bail!("signed entitlement time window is invalid");
    }
    let online = claims.capabilities.iter().collect::<HashSet<_>>();
    if claims
        .offline_capabilities
        .iter()
        .any(|capability| !online.contains(capability))
    {
        anyhow::bail!("offline entitlements must be a subset of online entitlements");
    }
    Ok(claims)
}

pub fn store_pairing_entitlement(
    db: &BridgeDb,
    bundle: &EntitlementPublicKey,
    token: &str,
    expected_device_id: &str,
) -> anyhow::Result<SignedEntitlementClaims> {
    if bundle.algorithm != "Ed25519" {
        anyhow::bail!("desktop entitlement key algorithm is unsupported");
    }
    let (bytes, _) = decode_public_key(&bundle.public_key_spki_base64)?;
    if bundle.key_id != key_id(&bytes) {
        anyhow::bail!("desktop entitlement public key id is invalid");
    }
    let claims = verify_token(token, &bundle.public_key_spki_base64, expected_device_id)?;
    db.set_setting(PUBLIC_KEY_SETTING, &bundle.public_key_spki_base64)?;
    db.set_setting(KEY_ID_SETTING, &bundle.key_id)?;
    db.set_setting(TOKEN_SETTING, token)?;
    Ok(claims)
}

pub fn store_refreshed_entitlement(
    db: &BridgeDb,
    bundle: &EntitlementPublicKey,
    token: &str,
    expected_device_id: &str,
) -> anyhow::Result<SignedEntitlementClaims> {
    let pinned_key = db
        .get_setting(PUBLIC_KEY_SETTING)?
        .context("desktop entitlement trust key is not pinned")?;
    let pinned_key_id = db
        .get_setting(KEY_ID_SETTING)?
        .context("desktop entitlement trust key id is not pinned")?;
    if bundle.public_key_spki_base64 != pinned_key || bundle.key_id != pinned_key_id {
        anyhow::bail!(
            "desktop entitlement signing key changed; explicitly re-pair this device to trust a new key"
        );
    }
    let claims = verify_token(token, &pinned_key, expected_device_id)?;
    db.set_setting(TOKEN_SETTING, token)?;
    Ok(claims)
}

pub fn effective_entitlement(
    db: &BridgeDb,
    device_id: Option<&str>,
) -> anyhow::Result<EffectiveEntitlement> {
    let Some(device_id) = device_id.filter(|value| !value.is_empty()) else {
        return Ok(EffectiveEntitlement {
            mode: "unpaired".to_string(),
            capabilities: vec![],
            expires_at: None,
            offline_grace_until: None,
            license_kind: None,
            major_version: None,
        });
    };
    let Some(token) = db.get_setting(TOKEN_SETTING)? else {
        return Ok(EffectiveEntitlement {
            mode: "unlicensed".to_string(),
            capabilities: vec![],
            expires_at: None,
            offline_grace_until: None,
            license_kind: None,
            major_version: None,
        });
    };
    let key = db
        .get_setting(PUBLIC_KEY_SETTING)?
        .context("desktop entitlement trust key is missing")?;
    let claims = verify_token(&token, &key, device_id)?;
    let now = OffsetDateTime::now_utc();
    let expires = parse_time(&claims.expires_at, "expiresAt")?;
    let grace = parse_time(&claims.offline_grace_until, "offlineGraceUntil")?;
    let (mode, capabilities) = if now <= expires {
        ("online", claims.capabilities.clone())
    } else if now <= grace {
        ("offline_grace", claims.offline_capabilities.clone())
    } else {
        ("expired", vec![])
    };
    Ok(EffectiveEntitlement {
        mode: mode.to_string(),
        capabilities,
        expires_at: Some(claims.expires_at),
        offline_grace_until: Some(claims.offline_grace_until),
        license_kind: claims.license.kind,
        major_version: claims.license.major_version,
    })
}

pub fn has_capability(db: &BridgeDb, device_id: Option<&str>, capability: &str) -> bool {
    effective_entitlement(db, device_id)
        .map(|state| state.capabilities.iter().any(|value| value == capability))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_id_is_stable_sha256_prefix() {
        assert_eq!(key_id(b"abc"), "ba7816bf8f01cfea414140de");
    }
}
