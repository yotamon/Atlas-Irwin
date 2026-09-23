use crate::db::BridgeDb;
use serde::{Deserialize, Serialize};

pub const EXECUTION_POLICY_VERSION: &str = "ensemblis.execution-policy.v1";
const POLICY_SETTING: &str = "execution_policy_v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionPreference {
    Automatic,
    PreferLocal,
    PreferCloud,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionPolicy {
    pub version: String,
    pub preference: ExecutionPreference,
    pub never_upload_audio: bool,
    pub allow_paid_compute: bool,
    pub cloud_fallback: bool,
}

impl Default for ExecutionPolicy {
    fn default() -> Self {
        Self {
            version: EXECUTION_POLICY_VERSION.to_string(),
            preference: ExecutionPreference::Automatic,
            never_upload_audio: false,
            allow_paid_compute: true,
            cloud_fallback: true,
        }
    }
}

pub fn validate(policy: &ExecutionPolicy) -> anyhow::Result<()> {
    if policy.version != EXECUTION_POLICY_VERSION {
        anyhow::bail!("unsupported execution policy version");
    }
    Ok(())
}

pub fn load(db: &BridgeDb) -> anyhow::Result<ExecutionPolicy> {
    let Some(value) = db.get_setting(POLICY_SETTING)? else {
        return Ok(ExecutionPolicy::default());
    };
    let policy: ExecutionPolicy = serde_json::from_str(&value)?;
    validate(&policy)?;
    Ok(policy)
}

pub fn save(db: &BridgeDb, policy: &ExecutionPolicy) -> anyhow::Result<()> {
    validate(policy)?;
    db.set_setting(POLICY_SETTING, &serde_json::to_string(policy)?)
}
