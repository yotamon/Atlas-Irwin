use crate::{db::BridgeDb, identity::fingerprint_file};
use anyhow::Context;
use std::path::PathBuf;

pub fn resolve_verified_media(
    db: &BridgeDb,
    source_id: &str,
    source_track_id: &str,
    expected_fingerprint: &str,
) -> anyhow::Result<PathBuf> {
    let binding = db.resolve_binding(source_id, source_track_id)?
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
        let verified = resolve_verified_media(&db, "local", &track.source_track_id, &track.recording_fingerprint).unwrap();
        assert_eq!(verified, path);

        fs::write(&path, b"changed-after-scan").unwrap();
        let error = resolve_verified_media(&db, "local", &track.source_track_id, &track.recording_fingerprint).unwrap_err();
        assert!(error.to_string().contains("changed after"));
    }
}
