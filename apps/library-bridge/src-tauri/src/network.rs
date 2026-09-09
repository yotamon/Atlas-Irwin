use crate::{
    credentials::{device_credential, store_device_credential},
    db::BridgeDb,
    execution::resolve_verified_media,
    model::{DeviceJob, DeviceJobResult, PairResponse},
};
use anyhow::Context;
use reqwest::blocking::{Client, Response};
use serde_json::{json, Value};
use std::time::Duration;
use url::Url;

fn api_url(base: &str, path: &str) -> anyhow::Result<String> {
    let base = Url::parse(base).context("invalid Ensemblis API URL")?;
    let local_dev = matches!(base.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if base.scheme() != "https" && !(local_dev && base.scheme() == "http") {
        anyhow::bail!("Library Bridge requires HTTPS outside localhost development");
    }
    Ok(base.join(path)?.to_string())
}

fn client() -> anyhow::Result<Client> {
    Ok(Client::builder()
        .timeout(Duration::from_secs(45))
        .user_agent("Ensemblis-Library-Bridge/0.1")
        .build()?)
}

fn require_success(response: Response) -> anyhow::Result<Response> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let body = response.text().unwrap_or_default();
    anyhow::bail!("Ensemblis API returned {status}: {body}")
}

fn auth_header() -> anyhow::Result<String> {
    device_credential()?.context("this Library Bridge is not paired")
}

pub fn claim_pairing(
    db: &BridgeDb,
    api_base_url: &str,
    pairing_code: &str,
    public_id: &str,
    name: &str,
    platform: &str,
    app_version: &str,
) -> anyhow::Result<PairResponse> {
    let response = require_success(client()?.post(api_url(api_base_url, "/api/dj-library/device/pair")?)
        .json(&json!({
            "version": "ensemblis.dj-library-device-pair.v1",
            "pairingCode": pairing_code.trim(),
            "publicId": public_id,
            "name": name,
            "platform": platform,
            "appVersion": app_version,
            "capabilities": {
                "scanLocalLibrary": true,
                "resolveLocalMedia": true,
                "deltaSync": true,
                "rekordboxXml": true
            }
        }))
        .send()?)?;
    let paired: PairResponse = response.json()?;
    store_device_credential(&paired.credential)?;
    db.set_setting("api_base_url", api_base_url)?;
    db.set_setting("device_id", &paired.device_id)?;
    db.set_setting("artist_id", &paired.artist_id)?;
    Ok(paired)
}

pub fn sync_next_batch(db: &BridgeDb) -> anyhow::Result<bool> {
    let pending = match db.next_outbox()? {
        Some(value) => value,
        None => return Ok(false),
    };
    let api_base = db.get_setting("api_base_url")?.context("Bridge API is not configured")?;
    let credential = auth_header()?;
    let response = require_success(client()?.post(api_url(&api_base, "/api/dj-library/device/sync")?)
        .bearer_auth(credential)
        .json(&pending.envelope)
        .send()?)?;
    let body: Value = response.json()?;
    let accepted_revision = body.get("revision").and_then(Value::as_str).unwrap_or_default();
    if accepted_revision != pending.envelope.delta.target_revision {
        anyhow::bail!("cloud acknowledged a different DJ-library revision");
    }
    db.acknowledge_outbox(pending.id)?;
    Ok(true)
}

fn post_job_result(db: &BridgeDb, result: &DeviceJobResult) -> anyhow::Result<()> {
    let api_base = db.get_setting("api_base_url")?.context("Bridge API is not configured")?;
    let credential = auth_header()?;
    require_success(client()?.post(api_url(&api_base, "/api/dj-library/device/jobs")?)
        .bearer_auth(credential)
        .json(result)
        .send()?)?;
    Ok(())
}

fn execute_job(db: &BridgeDb, job: &DeviceJob) -> DeviceJobResult {
    if job.version != crate::model::DEVICE_JOB_VERSION {
        return DeviceJobResult {
            job_id: job.id.clone(),
            status: "failed".to_string(),
            result: None,
            error: Some("unsupported device job contract".to_string()),
        };
    }
    if job.job_type != "resolve_media" {
        return DeviceJobResult {
            job_id: job.id.clone(),
            status: "failed".to_string(),
            result: None,
            error: Some(format!("unsupported device job type: {}", job.job_type)),
        };
    }
    let source_id = job.payload.get("sourceId").and_then(Value::as_str).unwrap_or_default();
    let source_track_id = job.payload.get("sourceTrackId").and_then(Value::as_str).unwrap_or_default();
    let fingerprint = job.payload.get("recordingFingerprint").and_then(Value::as_str).unwrap_or_default();
    match resolve_verified_media(db, source_id, source_track_id, fingerprint) {
        Ok(_) => DeviceJobResult {
            job_id: job.id.clone(),
            status: "completed".to_string(),
            // Never return the local path to the cloud. Availability and exact identity are enough.
            result: Some(json!({ "available": true, "verifiedFingerprint": fingerprint })),
            error: None,
        },
        Err(error) => DeviceJobResult {
            job_id: job.id.clone(),
            status: "failed".to_string(),
            result: None,
            error: Some(error.to_string()),
        },
    }
}

pub fn poll_and_execute_jobs(db: &BridgeDb) -> anyhow::Result<usize> {
    let api_base = db.get_setting("api_base_url")?.context("Bridge API is not configured")?;
    let credential = auth_header()?;
    let response = require_success(client()?.get(api_url(&api_base, "/api/dj-library/device/jobs")?)
        .bearer_auth(credential)
        .send()?)?;
    let body: Value = response.json()?;
    let jobs: Vec<DeviceJob> = serde_json::from_value(body.get("jobs").cloned().unwrap_or_else(|| json!([])))?;
    let mut completed = 0;
    for job in jobs {
        if !db.remember_job(&job.id, &job.idempotency_key, &job.job_type, &job.payload)? {
            continue;
        }
        let result = execute_job(db, &job);
        let local_status = if result.status == "completed" { "completed" } else { "failed" };
        db.complete_job(&job.id, local_status, result.result.as_ref())?;
        post_job_result(db, &result)?;
        completed += 1;
    }
    Ok(completed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_transport_rejects_plain_http() {
        assert!(api_url("http://ensemblis.example", "/api/test").is_err());
        assert!(api_url("https://ensemblis.example", "/api/test").is_ok());
        assert!(api_url("http://localhost:3000", "/api/test").is_ok());
    }
}
