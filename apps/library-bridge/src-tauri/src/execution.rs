use crate::{db::BridgeDb, identity::fingerprint_file, sidecar::RENDERER_VERSION};
use anyhow::Context;
use reqwest::{blocking::Client, redirect::Policy};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    net::{IpAddr, ToSocketAddrs},
    ops::Deref,
    path::{Path, PathBuf},
    time::Duration,
};
use url::Url;
use uuid::Uuid;

pub const RENDER_JOB_VERSION: &str = "ensemblis.library-bridge.render-job.v1";
pub const HYBRID_RENDER_JOB_VERSION: &str = "ensemblis.library-bridge.render-job.v2";
const MAX_REMOTE_SOURCE_BYTES: u64 = 600 * 1024 * 1024;
const MAX_REMOTE_REDIRECTS: usize = 6;

pub struct PreparedRenderRequest {
    payload: Value,
    temporary_sources: Option<PathBuf>,
}

impl Deref for PreparedRenderRequest {
    type Target = Value;
    fn deref(&self) -> &Self::Target {
        &self.payload
    }
}

impl Drop for PreparedRenderRequest {
    fn drop(&mut self) {
        if let Some(path) = &self.temporary_sources {
            let _ = fs::remove_dir_all(path);
        }
    }
}

pub fn resolve_verified_media(
    db: &BridgeDb,
    source_id: &str,
    source_track_id: &str,
    expected_fingerprint: &str,
) -> anyhow::Result<PathBuf> {
    let binding = db
        .resolve_binding(source_id, source_track_id)?
        .context("source track is not available on this device")?;
    if binding.recording_fingerprint != expected_fingerprint {
        anyhow::bail!("local binding does not match the frozen recording identity");
    }
    if !binding.path.is_file() {
        anyhow::bail!("local media file is missing");
    }
    let actual = fingerprint_file(&binding.path)?;
    if actual != expected_fingerprint {
        anyhow::bail!("local media changed after the library was scanned");
    }
    Ok(binding.path)
}

fn record(value: &Value) -> anyhow::Result<&serde_json::Map<String, Value>> {
    value
        .as_object()
        .context("local MixPlan render payload contains an invalid object")
}

fn string<'a>(value: &'a serde_json::Map<String, Value>, key: &str) -> anyhow::Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .context("local MixPlan render payload is missing required identity")
}

fn fingerprint(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            !value.is_private()
                && !value.is_loopback()
                && !value.is_link_local()
                && !value.is_unspecified()
                && !value.is_broadcast()
                && !value.is_documentation()
                && !value.is_multicast()
        }
        IpAddr::V6(value) => {
            !value.is_loopback()
                && !value.is_unspecified()
                && !value.is_multicast()
                && !value.is_unique_local()
                && !value.is_unicast_link_local()
        }
    }
}

fn checked_remote_url(value: &str) -> anyhow::Result<(Url, std::net::SocketAddr)> {
    let url = Url::parse(value).context("hybrid catalog source URL is invalid")?;
    if url.scheme() != "https" {
        anyhow::bail!("hybrid catalog sources require HTTPS");
    }
    let host = url.host_str().context("hybrid catalog source host is missing")?;
    if host.eq_ignore_ascii_case("localhost") || host.to_ascii_lowercase().ends_with(".internal") {
        anyhow::bail!("hybrid catalog source host is not public");
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = (host, port)
        .to_socket_addrs()
        .context("hybrid catalog source host could not be resolved")?
        .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
        anyhow::bail!("hybrid catalog source resolved to a non-public address");
    }
    Ok((url, addresses[0]))
}

fn remote_client(host: &str, address: std::net::SocketAddr) -> anyhow::Result<Client> {
    Ok(Client::builder()
        .timeout(Duration::from_secs(150))
        .redirect(Policy::none())
        .resolve(host, address)
        .user_agent("Ensemblis-Library-Bridge/0.1")
        .build()?)
}

fn download_verified_catalog_media(
    source_url: &str,
    expected_fingerprint: &str,
    directory: &Path,
    index: usize,
) -> anyhow::Result<PathBuf> {
    if !fingerprint(expected_fingerprint) {
        anyhow::bail!("hybrid catalog source fingerprint is invalid");
    }
    fs::create_dir_all(directory)?;
    let target = directory.join(format!("catalog-{index:02}.source"));
    let mut current = source_url.to_string();
    for _ in 0..MAX_REMOTE_REDIRECTS {
        let (url, address) = checked_remote_url(&current)?;
        let host = url.host_str().context("hybrid catalog source host is missing")?;
        let client = remote_client(host, address)?;
        let mut response = client.get(url.clone()).send()?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .context("hybrid catalog redirect omitted location")?;
            current = url.join(location)?.to_string();
            continue;
        }
        if !response.status().is_success() {
            anyhow::bail!("hybrid catalog source request failed");
        }
        if let Some(length) = response.content_length()
            && length > MAX_REMOTE_SOURCE_BYTES
        {
            anyhow::bail!("hybrid catalog source exceeds the download safety budget");
        }
        let mut file = File::create(&target)?;
        let mut total = 0_u64;
        let mut buffer = [0_u8; 1024 * 1024];
        loop {
            let count = response.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            total += count as u64;
            if total > MAX_REMOTE_SOURCE_BYTES {
                anyhow::bail!("hybrid catalog source exceeds the download safety budget");
            }
            file.write_all(&buffer[..count])?;
        }
        file.flush()?;
        if fingerprint_file(&target)? != expected_fingerprint {
            anyhow::bail!("hybrid catalog source does not match the frozen recording identity");
        }
        return Ok(target);
    }
    anyhow::bail!("hybrid catalog source exceeded the redirect safety limit")
}

fn mastering_map(plan_record: &serde_json::Map<String, Value>) -> Value {
    let mastering = plan_record
        .get("mastering")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    json!({
        "mastering_inspector": {
            "technical_ready": mastering.get("technical_ready"),
            "issue_counts": {
                "critical": mastering.get("critical_issues"),
                "warning": mastering.get("warning_issues"),
            },
            "loudness": { "integrated_lufs": mastering.get("integrated_lufs") },
            "peaks": {
                "true_peak_dbtp": mastering.get("true_peak_dbtp"),
                "clipping_ratio": mastering.get("clipping_ratio"),
            },
            "dynamics": {
                "crest_factor_db": mastering.get("crest_factor_db"),
                "loudness_range_lu": mastering.get("lra_lu"),
                "peak_to_loudness_ratio_lu": mastering.get("plr_lu"),
            }
        }
    })
}

fn rendered_track(
    candidate: &serde_json::Map<String, Value>,
    plan_record: &serde_json::Map<String, Value>,
    path: PathBuf,
    fingerprint: &str,
) -> anyhow::Result<Value> {
    let candidate_id = string(candidate, "candidateId")?;
    let source_window = plan_record
        .get("source")
        .and_then(Value::as_object)
        .context("local MixPlan source window is missing")?;
    let window_start = source_window
        .get("start_ms")
        .and_then(Value::as_i64)
        .filter(|value| *value >= 0)
        .context("local MixPlan source start is invalid")?;
    let window_end = source_window
        .get("end_ms")
        .and_then(Value::as_i64)
        .filter(|value| *value > window_start)
        .context("local MixPlan source end is invalid")?;
    let key = plan_record.get("key").cloned().unwrap_or_else(|| json!({}));
    Ok(json!({
        "trackId": candidate_id,
        "title": plan_record.get("title").or_else(|| candidate.get("title")).and_then(Value::as_str).unwrap_or("Untitled"),
        "path": path,
        "recordingFingerprint": fingerprint,
        "durationMs": window_end,
        "bpm": plan_record.get("source_bpm"),
        "djBpm": plan_record.get("dj_bpm"),
        "key": key,
        "energy": plan_record.get("energy"),
        "loudnessLufs": plan_record.get("mastering").and_then(Value::as_object).and_then(|value| value.get("integrated_lufs")),
        "musicMap": mastering_map(plan_record),
        "windowStartMs": window_start,
        "windowEndMs": window_end,
        "windowScore": plan_record.get("window_score").unwrap_or(&json!(0.5)),
    }))
}

fn prepare_v1(
    db: &BridgeDb,
    root: &serde_json::Map<String, Value>,
    mix_plan: &Value,
    plan_tracks: &[Value],
) -> anyhow::Result<Vec<Value>> {
    let mut plan_by_id = HashMap::<String, &Value>::new();
    for item in plan_tracks {
        let item_record = record(item)?;
        let track_id = string(item_record, "track_id")?.to_string();
        if plan_by_id.insert(track_id, item).is_some() {
            anyhow::bail!("local MixPlan contains duplicate track identities");
        }
    }
    let candidates = root
        .get("candidates")
        .and_then(Value::as_array)
        .context("local MixPlan render job has no candidates")?;
    if candidates.len() < 2 || candidates.len() > 20 || candidates.len() != plan_tracks.len() {
        anyhow::bail!("local MixPlan render candidate count is invalid");
    }
    let mut rendered_tracks = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let item = record(candidate)?;
        let candidate_id = string(item, "candidateId")?;
        let source_id = string(item, "sourceId")?;
        let source_track_id = string(item, "sourceTrackId")?;
        let fingerprint_value = string(item, "recordingFingerprint")?;
        let planning = item
            .get("planningEvidence")
            .and_then(Value::as_object)
            .context("local MixPlan candidate has no planning evidence")?;
        if planning.get("recordingFingerprint").and_then(Value::as_str) != Some(fingerprint_value) {
            anyhow::bail!("local MixPlan candidate evidence does not match recording identity");
        }
        let descriptor = planning
            .get("descriptor")
            .and_then(Value::as_object)
            .context("local MixPlan candidate descriptor is missing")?;
        let music_map = planning
            .get("musicMap")
            .filter(|value| value.is_object())
            .context("local MixPlan candidate music map is missing")?;
        let plan_item = plan_by_id
            .get(candidate_id)
            .context("local MixPlan candidate is not present in the frozen plan")?;
        let plan_record = record(plan_item)?;
        let source_window = plan_record
            .get("source")
            .and_then(Value::as_object)
            .context("local MixPlan source window is missing")?;
        let window_start = source_window
            .get("start_ms")
            .and_then(Value::as_i64)
            .filter(|value| *value >= 0)
            .context("local MixPlan source start is invalid")?;
        let window_end = source_window
            .get("end_ms")
            .and_then(Value::as_i64)
            .filter(|value| *value > window_start)
            .context("local MixPlan source end is invalid")?;
        let path = resolve_verified_media(db, source_id, source_track_id, fingerprint_value)?;
        rendered_tracks.push(json!({
            "trackId": candidate_id,
            "title": item.get("title").and_then(Value::as_str).unwrap_or("Untitled"),
            "path": path,
            "recordingFingerprint": fingerprint_value,
            "durationMs": descriptor.get("durationMs"),
            "bpm": descriptor.get("bpm"),
            "djBpm": descriptor.get("djBpm"),
            "key": descriptor.get("key"),
            "energy": descriptor.get("energy"),
            "loudnessLufs": descriptor.get("loudnessLufs"),
            "musicMap": music_map,
            "windowStartMs": window_start,
            "windowEndMs": window_end,
            "windowScore": plan_record.get("selection_score").or_else(|| plan_record.get("window_score")).unwrap_or(&json!(0.5)),
        }));
    }
    if plan_by_id.len() != rendered_tracks.len() {
        anyhow::bail!("local MixPlan source set is incomplete");
    }
    let _ = mix_plan;
    Ok(rendered_tracks)
}

fn prepare_v2(
    db: &BridgeDb,
    root: &serde_json::Map<String, Value>,
    mix_plan: &Value,
    plan_tracks: &[Value],
) -> anyhow::Result<(Vec<Value>, PathBuf)> {
    let provenance = mix_plan
        .get("provenance")
        .and_then(Value::as_object)
        .and_then(|value| value.get("source_fingerprints"))
        .and_then(Value::as_array)
        .context("hybrid MixPlan is missing source provenance")?;
    let provenance_by_id = provenance
        .iter()
        .map(|row| {
            let record = record(row)?;
            Ok((string(record, "track_id")?.to_string(), row))
        })
        .collect::<anyhow::Result<HashMap<_, _>>>()?;
    let plan_by_id = plan_tracks
        .iter()
        .map(|row| {
            let record = record(row)?;
            Ok((string(record, "track_id")?.to_string(), row))
        })
        .collect::<anyhow::Result<HashMap<_, _>>>()?;
    if provenance_by_id.len() != plan_tracks.len() || plan_by_id.len() != plan_tracks.len() {
        anyhow::bail!("hybrid MixPlan source provenance is incomplete");
    }
    let candidates = root
        .get("candidates")
        .and_then(Value::as_array)
        .context("hybrid MixPlan render job has no candidates")?;
    if candidates.len() != plan_tracks.len() || candidates.len() < 2 || candidates.len() > 20 {
        anyhow::bail!("hybrid MixPlan render candidate count is invalid");
    }
    let temp = std::env::temp_dir().join(format!("ensemblis-hybrid-{}", Uuid::new_v4()));
    fs::create_dir(&temp)?;
    let operation = (|| -> anyhow::Result<Vec<Value>> {
        let mut rendered = Vec::with_capacity(candidates.len());
        for (index, candidate) in candidates.iter().enumerate() {
            let item = record(candidate)?;
            let candidate_id = string(item, "candidateId")?;
            let expected = record(
                provenance_by_id
                    .get(candidate_id)
                    .context("hybrid candidate is missing frozen source provenance")?,
            )?;
            let expected_fingerprint = string(expected, "recording_fingerprint")?;
            if !fingerprint(expected_fingerprint)
                || item.get("recordingFingerprint").and_then(Value::as_str) != Some(expected_fingerprint)
            {
                anyhow::bail!("hybrid candidate does not match frozen content identity");
            }
            let target = string(item, "executionTarget")?;
            let path = match target {
                "device" => {
                    if expected.get("execution_target").and_then(Value::as_str) != Some("device") {
                        anyhow::bail!("hybrid device candidate provenance target mismatch");
                    }
                    let source_id = string(item, "sourceId")?;
                    let source_track_id = string(item, "sourceTrackId")?;
                    if expected.get("source_id").and_then(Value::as_str) != Some(source_id)
                        || expected.get("source_track_id").and_then(Value::as_str) != Some(source_track_id)
                    {
                        anyhow::bail!("hybrid device candidate source identity mismatch");
                    }
                    resolve_verified_media(db, source_id, source_track_id, expected_fingerprint)?
                }
                "cloud" => {
                    if expected.get("execution_target").and_then(Value::as_str) != Some("cloud")
                        || expected.get("source_kind").and_then(Value::as_str) != Some("artist_catalog")
                    {
                        anyhow::bail!("hybrid catalog candidate provenance target mismatch");
                    }
                    let source_url = string(item, "sourceUrl")?;
                    if expected.get("audio_url").and_then(Value::as_str) != Some(source_url) {
                        anyhow::bail!("hybrid catalog candidate canonical URL changed after planning");
                    }
                    download_verified_catalog_media(source_url, expected_fingerprint, &temp, index)?
                }
                _ => anyhow::bail!("hybrid candidate execution target is invalid"),
            };
            let plan_record = record(
                plan_by_id
                    .get(candidate_id)
                    .context("hybrid candidate is not present in the frozen MixPlan")?,
            )?;
            rendered.push(rendered_track(item, plan_record, path, expected_fingerprint)?);
        }
        Ok(rendered)
    })();
    match operation {
        Ok(rendered) => Ok((rendered, temp)),
        Err(error) => {
            let _ = fs::remove_dir_all(&temp);
            Err(error)
        }
    }
}

pub fn prepare_render_request(db: &BridgeDb, payload: &Value) -> anyhow::Result<PreparedRenderRequest> {
    let root = record(payload)?;
    let version = root.get("version").and_then(Value::as_str).unwrap_or_default();
    if version != RENDER_JOB_VERSION && version != HYBRID_RENDER_JOB_VERSION {
        anyhow::bail!("unsupported local MixPlan render job contract");
    }
    let plan_hash = string(root, "planHash")?;
    let output_format = string(root, "outputFormat")?;
    if !matches!(output_format, "wav" | "mp3") {
        anyhow::bail!("local MixPlan render format is unsupported");
    }
    let mix_plan = root
        .get("mixPlan")
        .filter(|value| value.is_object())
        .context("local MixPlan render job is missing the frozen MixPlan")?;
    if mix_plan.get("plan_hash").and_then(Value::as_str) != Some(plan_hash) {
        anyhow::bail!("local render job does not match the frozen MixPlan hash");
    }
    let plan_tracks = mix_plan
        .get("tracks")
        .and_then(Value::as_array)
        .context("local MixPlan has no tracks")?;
    let (rendered_tracks, temporary_sources) = if version == HYBRID_RENDER_JOB_VERSION {
        let (tracks, temp) = prepare_v2(db, root, mix_plan, plan_tracks)?;
        (tracks, Some(temp))
    } else {
        (prepare_v1(db, root, mix_plan, plan_tracks)?, None)
    };
    Ok(PreparedRenderRequest {
        payload: json!({
            "version": RENDERER_VERSION,
            "planHash": plan_hash,
            "outputFormat": output_format,
            "mixPlan": mix_plan,
            "tracks": rendered_tracks,
        }),
        temporary_sources,
    })
}

pub fn public_render_result(local: &Value) -> anyhow::Result<Value> {
    let result = record(local)?;
    if result.get("version").and_then(Value::as_str) != Some(RENDERER_VERSION)
        || result.get("status").and_then(Value::as_str) != Some("completed")
    {
        anyhow::bail!("local renderer result contract is invalid");
    }
    let plan_hash = string(result, "planHash")?;
    let output_format = string(result, "outputFormat")?;
    let sha256 = string(result, "sha256")?;
    let file_size = result
        .get("fileSize")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .context("local renderer result size is invalid")?;
    if !sha256.starts_with("sha256:") || !matches!(output_format, "wav" | "mp3") {
        anyhow::bail!("local renderer result identity is invalid");
    }
    Ok(json!({
        "version": RENDERER_VERSION,
        "status": "completed",
        "planHash": plan_hash,
        "outputFormat": output_format,
        "mimeType": if output_format == "wav" { "audio/wav" } else { "audio/mpeg" },
        "sha256": sha256,
        "fileSize": file_size,
        "render": result.get("render").cloned().unwrap_or_else(|| json!({})),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db::BridgeDb, scanner::scan_source};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn execution_fails_closed_when_file_changes() {
        let directory = tempdir().unwrap();
        let library = directory.path().join("library");
        fs::create_dir_all(&library).unwrap();
        let path = library.join("Track.wav");
        fs::write(&path, b"original").unwrap();
        let db = BridgeDb::new(directory.path().join("bridge.sqlite3")).unwrap();
        scan_source(&db, "local", "local_library", &library).unwrap();
        let outbox = db.next_outbox().unwrap().unwrap();
        let track = &outbox.envelope.delta.changed_tracks[0];
        let verified = resolve_verified_media(
            &db,
            "local",
            &track.source_track_id,
            &track.recording_fingerprint,
        )
        .unwrap();
        assert_eq!(verified, path);

        fs::write(&path, b"changed-after-scan").unwrap();
        let error = resolve_verified_media(
            &db,
            "local",
            &track.source_track_id,
            &track.recording_fingerprint,
        )
        .unwrap_err();
        assert!(error.to_string().contains("changed after"));
    }

    #[test]
    fn remote_catalog_sources_require_https_and_public_dns() {
        assert!(checked_remote_url("http://example.com/track.wav").is_err());
        assert!(checked_remote_url("https://127.0.0.1/track.wav").is_err());
        assert!(checked_remote_url("https://localhost/track.wav").is_err());
    }

    #[test]
    fn public_render_result_never_contains_local_output_path() {
        let local = json!({
            "version": RENDERER_VERSION,
            "status": "completed",
            "planHash": "a".repeat(64),
            "outputFormat": "wav",
            "mimeType": "audio/wav",
            "outputPath": "/Users/example/Music/private/mix.wav",
            "sha256": format!("sha256:{}", "b".repeat(64)),
            "fileSize": 1024,
            "render": {"duration_ms": 1000}
        });
        let public = public_render_result(&local).unwrap();
        let serialized = serde_json::to_string(&public).unwrap();
        assert!(!serialized.contains("/Users/"));
        assert!(public.get("outputPath").is_none());
    }
}
