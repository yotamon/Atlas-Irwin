mod credentials;
mod db;
mod execution;
mod identity;
mod model;
mod network;
mod scanner;

use crate::{
    credentials::{clear_device_credential, device_credential},
    db::BridgeDb,
    identity::hash_text,
    model::{BridgeStatus, PairResponse, ScanSummary},
};
use std::sync::Arc;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

#[derive(Clone)]
struct BridgeState {
    db: Arc<BridgeDb>,
}

fn command_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
fn bridge_status(state: State<'_, BridgeState>) -> Result<BridgeStatus, String> {
    let device_id = state.db.get_setting("device_id").map_err(command_error)?
        .filter(|value| !value.is_empty());
    Ok(BridgeStatus {
        paired: device_id.is_some() && device_credential().map_err(command_error)?.is_some(),
        device_id,
        api_base_url: state.db.get_setting("api_base_url").map_err(command_error)?
            .filter(|value| !value.is_empty()),
        sources: state.db.source_count().map_err(command_error)?,
        pending_sync_batches: state.db.pending_outbox_count().map_err(command_error)?,
    })
}

#[tauri::command]
async fn choose_and_scan_source(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
    source_kind: String,
) -> Result<Option<ScanSummary>, String> {
    let path = app.dialog().file()
        .set_title("Choose a DJ music library folder")
        .blocking_pick_folder();
    let Some(path) = path else { return Ok(None) };
    let path = path.into_path().map_err(command_error)?;
    let source_id = format!("device-source-{}", Uuid::new_v4());
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || scanner::scan_source(&db, &source_id, &source_kind, &path))
        .await.map_err(command_error)?
        .map(Some).map_err(command_error)
}

#[tauri::command]
async fn rescan_source(state: State<'_, BridgeState>, source_id: String) -> Result<ScanSummary, String> {
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || scanner::rescan_registered_source(&db, &source_id))
        .await.map_err(command_error)?.map_err(command_error)
}

#[tauri::command]
async fn pair_device(
    state: State<'_, BridgeState>,
    api_base_url: String,
    pairing_code: String,
    device_name: Option<String>,
) -> Result<PairResponse, String> {
    let public_id = state.db.get_setting("public_id").map_err(command_error)?
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    state.db.set_setting("public_id", &public_id).map_err(command_error)?;
    let name = device_name.filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Ensemblis Library Bridge".to_string());
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || network::claim_pairing(
        &db,
        &api_base_url,
        &pairing_code,
        &public_id,
        &name,
        std::env::consts::OS,
        env!("CARGO_PKG_VERSION"),
    )).await.map_err(command_error)?.map_err(command_error)
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
    }).await.map_err(command_error)?.map_err(command_error)
}

#[tauri::command]
async fn poll_device_jobs(state: State<'_, BridgeState>) -> Result<usize, String> {
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || network::poll_and_execute_jobs(&db))
        .await.map_err(command_error)?.map_err(command_error)
}

#[tauri::command]
fn unpair_device(state: State<'_, BridgeState>) -> Result<(), String> {
    clear_device_credential().map_err(command_error)?;
    state.db.set_setting("device_id", "").map_err(command_error)?;
    state.db.set_setting("artist_id", "").map_err(command_error)?;
    Ok(())
}

#[tauri::command]
fn privacy_contract_probe() -> serde_json::Value {
    // Kept deliberately path-free so integration tests can assert the command boundary itself.
    serde_json::json!({
        "recordingIdentity": "content-sha256",
        "cloudFields": ["sourceTrackId", "recordingFingerprint", "metadata", "playlistIds", "cuePoints", "beatGrid", "analysisProvenance", "availability"],
        "forbiddenCloudFields": ["path", "filePath", "location", "fileUri"],
        "contractHash": hash_text("ensemblis.library-bridge.privacy.v1")
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data = app.path().app_local_data_dir()?;
            let db = BridgeDb::new(app_data.join("library-bridge.sqlite3"))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            app.manage(BridgeState { db: Arc::new(db) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bridge_status,
            choose_and_scan_source,
            rescan_source,
            pair_device,
            sync_pending,
            poll_device_jobs,
            unpair_device,
            privacy_contract_probe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ensemblis Library Bridge");
}
