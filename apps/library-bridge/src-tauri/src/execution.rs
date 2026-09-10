use crate::{db::BridgeDb, identity::fingerprint_file, sidecar::RENDERER_VERSION};
use anyhow::Context;
use serde_json::{Value, json};
use std::{collections::HashMap, path::PathBuf};

pub const RENDER_JOB_VERSION: &str = "ensemblis.library-bridge.render-job.v1";

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

pub fn prepare_render_request(db: &BridgeDb, payload: &Value) -> anyhow::Result<Value> {
    let root = record(payload)?;
    if root.get("version").and_then(Value::as_str) != Some(RENDER_JOB_VERSION) {
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
        let fingerprint = string(item, "recordingFingerprint")?;
        if !fingerprint.starts_with("sha256:") {
            anyhow::bail!("local MixPlan candidate recording identity is invalid");
        }
        let planning = item
            .get("planningEvidence")
            .and_then(Value::as_object)
            .context("local MixPlan candidate has no planning evidence")?;
        if planning.get("recordingFingerprint").and_then(Value::as_str) != Some(fingerprint) {
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
        let path = resolve_verified_media(db, source_id, source_track_id, fingerprint)?;
        rendered_tracks.push(json!({
            "trackId": candidate_id,
            "title": item.get("title").and_then(Value::as_str).unwrap_or("Untitled"),
            "path": path,
            "recordingFingerprint": fingerprint,
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

    Ok(json!({
        "version": RENDERER_VERSION,
        "planHash": plan_hash,
        "outputFormat": output_format,
        "mixPlan": mix_plan,
        "tracks": rendered_tracks,
    }))
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
