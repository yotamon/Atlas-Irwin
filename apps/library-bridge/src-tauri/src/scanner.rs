use crate::{
    db::BridgeDb,
    identity::{fingerprint_file, hash_text},
    model::{CloudTrackDelta, ScanSummary, ScannedTrack, TrackMetadata},
    sidecar::{self, AnalysisInput},
};
use anyhow::Context;
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use walkdir::WalkDir;

const AUDIO_EXTENSIONS: &[&str] = &[
    "wav", "aif", "aiff", "flac", "mp3", "m4a", "aac", "ogg", "opus",
];
const ANALYSIS_BATCH_SIZE: usize = 8;

#[derive(Debug, Clone)]
struct ScanSeed {
    path: PathBuf,
    file_size: u64,
    modified_unix_ms: i64,
    fingerprint: String,
}

fn supported_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| AUDIO_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn modified_ms(modified: SystemTime) -> i64 {
    modified
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

fn title_for(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled")
        .to_string()
}

fn generic_metadata(path: &Path) -> TrackMetadata {
    TrackMetadata {
        title: title_for(path),
        artist: None,
        album: None,
        remix: None,
        genre: None,
        comments: None,
        duration_ms: None,
        bpm: None,
        musical_key: None,
        rating: None,
        color: None,
        tags: Vec::new(),
        year: None,
    }
}

fn cached_cloud_evidence(
    db: &BridgeDb,
    fingerprint: &str,
    path: &Path,
) -> anyhow::Result<(TrackMetadata, Value, Value, Option<Value>)> {
    let fallback = generic_metadata(path);
    let Some(cached) = db.cached_analysis(fingerprint)? else {
        return Ok((fallback, Value::Null, json!([]), None));
    };
    let metadata = cached
        .get("metadata")
        .cloned()
        .and_then(|value| serde_json::from_value::<TrackMetadata>(value).ok())
        .map(|mut value| {
            // Generic-folder title is location-derived metadata, not recording identity. Keep musical
            // analysis cached across moves while reflecting the current filename after a rename.
            value.title = title_for(path);
            value
        })
        .unwrap_or(fallback);
    let beat_grid = cached.get("beatGrid").cloned().unwrap_or(Value::Null);
    let provenance = cached
        .get("analysisProvenance")
        .cloned()
        .filter(Value::is_array)
        .unwrap_or_else(|| json!([]));
    let planning_evidence = cached
        .get("planningEvidence")
        .cloned()
        .filter(Value::is_object);
    Ok((metadata, beat_grid, provenance, planning_evidence))
}

fn collect_seeds(db: &BridgeDb, source_id: &str, root: &Path) -> anyhow::Result<Vec<ScanSeed>> {
    let mut seeds = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !entry.file_type().is_file() || !supported_audio(path) {
            continue;
        }
        let metadata = entry.metadata()?;
        let file_size = metadata.len();
        let modified_unix_ms = metadata.modified().map(modified_ms).unwrap_or(0);
        let fingerprint =
            match db.cached_fingerprint(source_id, path, file_size, modified_unix_ms)? {
                Some(value) => value,
                None => fingerprint_file(path)?,
            };
        seeds.push(ScanSeed {
            path: path.to_path_buf(),
            file_size,
            modified_unix_ms,
            fingerprint,
        });
    }
    seeds.sort_by(|a, b| a.fingerprint.cmp(&b.fingerprint));
    Ok(seeds)
}

fn analyze_uncached(
    db: &BridgeDb,
    seeds: &[ScanSeed],
    sidecar_binary: &Path,
    work_root: &Path,
) -> anyhow::Result<()> {
    let mut missing = Vec::new();
    for seed in seeds {
        if db.cached_analysis(&seed.fingerprint)?.is_none() {
            missing.push(AnalysisInput {
                path: seed.path.clone(),
                fingerprint: seed.fingerprint.clone(),
            });
        }
    }
    for batch in missing.chunks(ANALYSIS_BATCH_SIZE) {
        // Per-track decoder/analysis failures are represented as omitted completed rows by the
        // sidecar. A broken source never prevents the rest of the library revision from scanning.
        for result in sidecar::analyze_batch(sidecar_binary, work_root, batch)? {
            db.store_analysis(
                &result.fingerprint,
                &result.analyzer_version,
                &result.payload,
            )?;
        }
    }
    Ok(())
}

fn build_tracks(db: &BridgeDb, seeds: Vec<ScanSeed>) -> anyhow::Result<Vec<ScannedTrack>> {
    let mut tracks = Vec::with_capacity(seeds.len());
    for seed in seeds {
        // Local generic sources use content identity as source-track identity. Moving a file therefore
        // changes only the private binding, never the normalized track identity used by the planner.
        let source_track_id = seed.fingerprint.clone();
        let (track_metadata, beat_grid, cached_provenance, planning_evidence) =
            cached_cloud_evidence(db, &seed.fingerprint, &seed.path)?;
        let mut analysis_provenance = vec![json!({
            "field": "identity",
            "source": "ensemblis.library-bridge.sha256.v1",
            "confidence": 1.0
        })];
        if let Some(items) = cached_provenance.as_array() {
            analysis_provenance.extend(items.iter().cloned());
        }
        let cloud = CloudTrackDelta {
            source_track_id,
            recording_fingerprint: seed.fingerprint,
            metadata: track_metadata,
            playlist_ids: Vec::new(),
            cue_points: json!([]),
            beat_grid,
            analysis_provenance: Value::Array(analysis_provenance),
            planning_evidence,
            availability: "available".to_string(),
        };
        let cloud_json = serde_json::to_string(&cloud)?;
        tracks.push(ScannedTrack {
            path: seed.path,
            file_size: seed.file_size,
            modified_unix_ms: seed.modified_unix_ms,
            payload_hash: hash_text(&cloud_json),
            cloud,
        });
    }
    Ok(tracks)
}

fn persist_tracks(
    db: &BridgeDb,
    source_id: &str,
    source_kind: &str,
    root: &Path,
    tracks: Vec<ScannedTrack>,
) -> anyhow::Result<ScanSummary> {
    let revision_input = tracks
        .iter()
        .map(|track| format!("{}:{}", track.cloud.source_track_id, track.payload_hash))
        .collect::<Vec<_>>()
        .join("\n");
    let revision = hash_text(&revision_input).replace("sha256:", "bridge1:");
    db.persist_scan(source_id, source_kind, root, &revision, &tracks)
        .with_context(|| format!("could not persist scan for {source_id}"))
}

pub fn scan_source(
    db: &BridgeDb,
    source_id: &str,
    source_kind: &str,
    root: &Path,
) -> anyhow::Result<ScanSummary> {
    if !root.is_dir() {
        anyhow::bail!("selected DJ library source is not a directory");
    }
    let seeds = collect_seeds(db, source_id, root)?;
    persist_tracks(db, source_id, source_kind, root, build_tracks(db, seeds)?)
}

pub fn scan_source_with_sidecar(
    db: &BridgeDb,
    source_id: &str,
    source_kind: &str,
    root: &Path,
    sidecar_binary: &Path,
    work_root: &Path,
) -> anyhow::Result<ScanSummary> {
    if !root.is_dir() {
        anyhow::bail!("selected DJ library source is not a directory");
    }
    let seeds = collect_seeds(db, source_id, root)?;
    analyze_uncached(db, &seeds, sidecar_binary, work_root)?;
    persist_tracks(db, source_id, source_kind, root, build_tracks(db, seeds)?)
}

pub fn rescan_registered_source(db: &BridgeDb, source_id: &str) -> anyhow::Result<ScanSummary> {
    let (kind, root) = db
        .source_root(source_id)?
        .context("DJ library source is not registered on this device")?;
    scan_source(db, source_id, &kind, &root)
}

pub fn rescan_registered_source_with_sidecar(
    db: &BridgeDb,
    source_id: &str,
    sidecar_binary: &Path,
    work_root: &Path,
) -> anyhow::Result<ScanSummary> {
    let (kind, root) = db
        .source_root(source_id)?
        .context("DJ library source is not registered on this device")?;
    scan_source_with_sidecar(db, source_id, &kind, &root, sidecar_binary, work_root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn scan_delta_is_path_free_and_move_keeps_track_identity() {
        let directory = tempdir().unwrap();
        let library = directory.path().join("library");
        fs::create_dir_all(&library).unwrap();
        let first = library.join("Original.wav");
        fs::write(&first, b"audio-content").unwrap();
        let db = BridgeDb::new(directory.path().join("bridge.sqlite3")).unwrap();

        let initial = scan_source(&db, "local", "local_library", &library).unwrap();
        assert_eq!(initial.track_count, 1);
        let outbox = db.next_outbox().unwrap().unwrap();
        let serialized = serde_json::to_string(&outbox.envelope).unwrap();
        assert!(!serialized.contains(library.to_string_lossy().as_ref()));
        let identity = outbox.envelope.delta.changed_tracks[0]
            .source_track_id
            .clone();
        db.acknowledge_outbox(outbox.id).unwrap();

        let moved = library.join("Moved.wav");
        fs::rename(first, &moved).unwrap();
        let after_move = scan_source(&db, "local", "local_library", &library).unwrap();
        assert_eq!(after_move.track_count, 1);
        let binding = db.resolve_binding("local", &identity).unwrap().unwrap();
        assert_eq!(binding.path, moved);
        assert_eq!(binding.recording_fingerprint, identity);
    }

    #[test]
    fn analysis_cache_follows_recording_identity_across_moves() {
        let directory = tempdir().unwrap();
        let library = directory.path().join("library");
        fs::create_dir_all(&library).unwrap();
        let original = library.join("Original.wav");
        fs::write(&original, b"stable-recording").unwrap();
        let db = BridgeDb::new(directory.path().join("bridge.sqlite3")).unwrap();
        scan_source(&db, "local", "local_library", &library).unwrap();
        let fingerprint = fingerprint_file(&original).unwrap();
        db.store_analysis(
            &fingerprint,
            "test-analyzer",
            &json!({
                "metadata": {
                    "title": "Original", "artist": null, "album": null, "remix": null,
                    "genre": null, "comments": null, "durationMs": 123000, "bpm": 124.0,
                    "musicalKey": "8A", "rating": null, "color": null, "tags": [], "year": null
                },
                "beatGrid": {"bpm": 124.0, "firstBeatMs": 0, "beatsPerBar": 4, "confidence": 0.9},
                "analysisProvenance": [{"field": "bpm", "source": "test-analyzer", "confidence": 1.0}],
                "planningEvidence": {"version": "ensemblis.dj-library-planning-evidence.v1"}
            }),
        )
        .unwrap();
        let moved = library.join("Moved.wav");
        fs::rename(&original, &moved).unwrap();
        let summary = scan_source(&db, "local", "local_library", &library).unwrap();
        assert!(summary.queued_for_sync);
        let outbox = db.next_outbox().unwrap().unwrap();
        let track = outbox
            .envelope
            .delta
            .changed_tracks
            .iter()
            .find(|track| track.recording_fingerprint == fingerprint)
            .unwrap();
        assert_eq!(track.metadata.bpm, Some(124.0));
        assert_eq!(track.metadata.title, "Moved");
        assert!(track.planning_evidence.is_some());
        let serialized = serde_json::to_string(track).unwrap();
        assert!(!serialized.contains(library.to_string_lossy().as_ref()));
    }
}
