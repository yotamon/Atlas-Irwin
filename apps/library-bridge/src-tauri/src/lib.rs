mod credentials;
mod db;
mod execution;
mod export;
mod identity;
mod model;
mod network;
mod scanner;
mod sidecar;
mod watcher;

use crate::{
    credentials::{clear_device_credential, device_credential},
    db::BridgeDb,
    export::ExportedRender,
    identity::hash_text,
    model::{BridgeStatus, PairResponse, ScanSummary},
    watcher::LibraryWatcher,
};
use std::{path::PathBuf, sync::Arc};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

#[derive(Clone)]
struct BridgeState {
    db: Arc<BridgeDb>,
    watcher: Arc<LibraryWatcher>,
    sidecar_binary: Option<PathBuf>,
    sidecar_work_root: PathBuf,
}

fn command_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
fn bridge_status(state: State<'_, BridgeState>) -> Result<BridgeStatus, String> {
    let device_id = state
        .db
        .get_setting("device_id")
        .map_err(command_error)?
        .filter(|value| !value.is_empty());
    Ok(BridgeStatus {
        paired: device_id.is_some() && device_credential().map_err(command_error)?.is_some(),
        device_id,
        api_base_url: state
            .db
            .get_setting("api_base_url")
            .map_err(command_error)?
            .filter(|value| !value.is_empty()),
        sources: state.db.source_count().map_err(command_error)?,
        pending_sync_batches: state.db.pending_outbox_count().map_err(command_error)?,
        local_intelligence_available: state
            .sidecar_binary
            .as_deref()
            .is_some_and(|binary| binary.is_file()),
    })
}

fn scan_with_available_intelligence(
    db: &BridgeDb,
    source_id: &str,
    source_kind: &str,
    path: &std::path::Path,
    sidecar_binary: Option<&std::path::Path>,
    work_root: &std::path::Path,
) -> anyhow::Result<ScanSummary> {
    match sidecar_binary.filter(|binary| binary.is_file()) {
        Some(binary) => {
            scanner::scan_source_with_sidecar(db, source_id, source_kind, path, binary, work_root)
        }
        None => scanner::scan_source(db, source_id, source_kind, path),
    }
}

#[tauri::command]
async fn choose_and_scan_source(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
    source_kind: String,
) -> Result<Option<ScanSummary>, String> {
    if source_kind != "local_library" {
        return Err("The folder scanner only accepts the local_library source kind.".to_string());
    }
    let path = app
        .dialog()
        .file()
        .set_title("Choose a DJ music library folder")
        .blocking_pick_folder();
    let Some(path) = path else { return Ok(None) };
    let path = path.into_path().map_err(command_error)?;
    let source_id = format!("device-source-{}", Uuid::new_v4());
    let db = Arc::clone(&state.db);
    let scan_path = path.clone();
    let scan_source_id = source_id.clone();
    let scan_source_kind = source_kind.clone();
    let sidecar_binary = state.sidecar_binary.clone();
    let work_root = state.sidecar_work_root.clone();
    let summary = tauri::async_runtime::spawn_blocking(move || {
        scan_with_available_intelligence(
            &db,
            &scan_source_id,
            &scan_source_kind,
            &scan_path,
            sidecar_binary.as_deref(),
            &work_root,
        )
    })
    .await
    .map_err(command_error)?
    .map_err(command_error)?;
    state
        .watcher
        .register_source(&source_id, &source_kind, &path)
        .map_err(command_error)?;
    Ok(Some(summary))
}

#[tauri::command]
async fn rescan_source(
    state: State<'_, BridgeState>,
    source_id: String,
) -> Result<ScanSummary, String> {
    let db = Arc::clone(&state.db);
    let sidecar_binary = state.sidecar_binary.clone();
    let work_root = state.sidecar_work_root.clone();
    tauri::async_runtime::spawn_blocking(move || match sidecar_binary.as_deref() {
        Some(binary) if binary.is_file() => {
            scanner::rescan_registered_source_with_sidecar(&db, &source_id, binary, &work_root)
        }
        _ => scanner::rescan_registered_source(&db, &source_id),
    })
    .await
    .map_err(command_error)?
    .map_err(command_error)
}

#[tauri::command]
async fn pair_device(
    state: State<'_, BridgeState>,
    api_base_url: String,
    pairing_code: String,
    device_name: Option<String>,
) -> Result<PairResponse, String> {
    let public_id = state
        .db
        .get_setting("public_id")
        .map_err(command_error)?
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    state
        .db
        .set_setting("public_id", &public_id)
        .map_err(command_error)?;
    let name = device_name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Ensemblis Library Bridge".to_string());
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || {
        network::claim_pairing(
            &db,
            &api_base_url,
            &pairing_code,
            &public_id,
            &name,
            std::env::consts::OS,
            env!("CARGO_PKG_VERSION"),
        )
    })
    .await
    .map_err(command_error)?
    .map_err(command_error)
}

#[tauri::command]
async fn sync_pending(state: State<'_, BridgeState>) -> Result<usize, String> {
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<usize> {
        let mut sent = 0;
        while sent < 20 && network::sync_next_batch(&db)? {
            sent += 1;
        }
        Ok(sent)
    })
    .await
    .map_err(command_error)?
    .map_err(command_error)
}

#[tauri::command]
async fn poll_device_jobs(state: State<'_, BridgeState>) -> Result<usize, String> {
    let db = Arc::clone(&state.db);
    let sidecar_binary = state.sidecar_binary.clone();
    let work_root = state.sidecar_work_root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        network::poll_and_execute_jobs(&db, sidecar_binary.as_deref(), &work_root)
    })
    .await
    .map_err(command_error)?
    .map_err(command_error)
}

#[tauri::command]
async fn export_latest_render(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
) -> Result<Option<ExportedRender>, String> {
    let asset = export::latest_completed_render(&state.sidecar_work_root).map_err(command_error)?;
    let Some(asset) = asset else { return Ok(None) };
    let destination = app
        .dialog()
        .file()
        .set_title("Choose where to export the latest Ensemblis mix")
        .blocking_pick_folder();
    let Some(destination) = destination else {
        return Ok(None);
    };
    let destination = destination.into_path().map_err(command_error)?;
    tauri::async_runtime::spawn_blocking(move || export::export_render(&asset, &destination))
        .await
        .map_err(command_error)?
        .map(Some)
        .map_err(command_error)
}

#[tauri::command]
fn unpair_device(state: State<'_, BridgeState>) -> Result<(), String> {
    clear_device_credential().map_err(command_error)?;
    state
        .db
        .set_setting("device_id", "")
        .map_err(command_error)?;
    state
        .db
        .set_setting("artist_id", "")
        .map_err(command_error)?;
    Ok(())
}

#[tauri::command]
fn privacy_contract_probe() -> serde_json::Value {
    // Kept deliberately path-free so integration tests can assert the command boundary itself.
    serde_json::json!({
        "recordingIdentity": "content-sha256",
        "cloudFields": ["sourceTrackId", "recordingFingerprint", "metadata", "playlistIds", "cuePoints", "beatGrid", "analysisProvenance", "planningEvidence", "availability"],
        "forbiddenCloudFields": ["path", "filePath", "location", "fileUri"],
        "contractHash": hash_text("ensemblis.library-bridge.privacy.v2")
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data = app.path().app_local_data_dir()?;
            let db = Arc::new(
                BridgeDb::new(app_data.join("library-bridge.sqlite3"))
                    .map_err(|error| std::io::Error::other(error.to_string()))?,
            );
            let sidecar_binary = sidecar::bundled_sidecar_path()
                .ok()
                .filter(|path| path.is_file());
            let sidecar_work_root = app_data.join("sidecar-work");
            let watcher = Arc::new(
                LibraryWatcher::start(
                    Arc::clone(&db),
                    sidecar_binary.clone(),
                    sidecar_work_root.clone(),
                )
                .map_err(|error| std::io::Error::other(error.to_string()))?,
            );
            app.manage(BridgeState {
                db,
                watcher,
                sidecar_binary,
                sidecar_work_root,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bridge_status,
            choose_and_scan_source,
            rescan_source,
            pair_device,
            sync_pending,
            poll_device_jobs,
            export_latest_render,
            unpair_device,
            privacy_contract_probe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ensemblis Library Bridge");
}
