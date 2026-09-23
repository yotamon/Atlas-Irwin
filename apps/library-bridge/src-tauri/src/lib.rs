mod analysis;
mod browser_pairing;
mod credentials;
mod db;
mod entitlements;
mod execution;
mod execution_policy;
mod export;
mod identity;
mod license_file;
mod model;
mod model_catalog;
mod models;
mod network;
mod privacy;
mod project;
mod project_mutation;
mod runtime_task;
mod scanner;
mod sidecar;
mod watcher;

use crate::{
    credentials::{clear_device_credential, device_credential},
    db::BridgeDb,
    entitlements::EffectiveEntitlement,
    execution_policy::ExecutionPolicy,
    export::ExportedRender,
    identity::hash_text,
    model::{BridgeStatus, PairResponse, ScanSummary},
    models::{InstalledModel, ModelDescriptor},
    project::{ProjectManifest, ProjectRecording},
    project_mutation::PortableProjectMutation,
    runtime_task::{LocalRuntimeTaskResult, RuntimeTask},
    watcher::LibraryWatcher,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    Manager, State,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use url::Url;
use uuid::Uuid;

const DEFAULT_API_BASE_URL: &str = "https://atlasirwin.com";
const BACKGROUND_MAINTENANCE_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Clone)]
struct BridgeState {
    db: Arc<BridgeDb>,
    db_path: PathBuf,
    watcher: Arc<LibraryWatcher>,
    sidecar_binary: Option<PathBuf>,
    sidecar_work_root: PathBuf,
    model_root: PathBuf,
    maintenance_lock: Arc<Mutex<()>>,
}

fn command_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn device_id(db: &BridgeDb) -> anyhow::Result<Option<String>> {
    Ok(db
        .get_setting("device_id")?
        .filter(|value| !value.is_empty()))
}

fn public_device_id(db: &BridgeDb) -> anyhow::Result<String> {
    let public_id = db
        .get_setting("public_id")?
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    db.set_setting("public_id", &public_id)?;
    Ok(public_id)
}

fn default_device_name() -> String {
    "Ensemblis on this computer".to_string()
}

fn local_track_count(db_path: &std::path::Path) -> anyhow::Result<usize> {
    let connection = rusqlite::Connection::open(db_path)?;
    let count: i64 = connection.query_row(
        "select count(distinct recording_fingerprint) from file_bindings",
        [],
        |row| row.get(0),
    )?;
    Ok(count.max(0) as usize)
}

fn local_processing_enabled(db: &BridgeDb) -> bool {
    let id = device_id(db).ok().flatten();
    entitlements::has_capability(db, id.as_deref(), "local.processing")
}

#[tauri::command]
fn bridge_status(state: State<'_, BridgeState>) -> Result<BridgeStatus, String> {
    let device_id = device_id(&state.db).map_err(command_error)?;
    let entitlement = entitlements::effective_entitlement(&state.db, device_id.as_deref())
        .map_err(command_error)?;
    let local_intelligence_available = state
        .sidecar_binary
        .as_deref()
        .is_some_and(|binary| binary.is_file())
        && entitlement
            .capabilities
            .iter()
            .any(|value| value == "local.processing");
    Ok(BridgeStatus {
        paired: device_id.is_some() && device_credential().map_err(command_error)?.is_some(),
        device_id,
        api_base_url: state
            .db
            .get_setting("api_base_url")
            .map_err(command_error)?
            .filter(|value| !value.is_empty()),
        sources: state.db.source_count().map_err(command_error)?,
        tracks: local_track_count(&state.db_path).map_err(command_error)?,
        pending_sync_batches: state.db.pending_outbox_count().map_err(command_error)?,
        local_intelligence_available,
        entitlement_mode: entitlement.mode,
        capabilities: entitlement.capabilities,
        license_kind: entitlement.license_kind,
        license_major_version: entitlement.major_version,
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
    match sidecar_binary
        .filter(|binary| binary.is_file())
        .filter(|_| local_processing_enabled(db))
    {
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
        .set_title("Choose your music folder")
        .blocking_pick_folder();
    let Some(path) = path else {
        return Ok(None);
    };
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
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<ScanSummary> {
        let (source_kind, root) = db
            .source_root(&source_id)?
            .ok_or_else(|| anyhow::anyhow!("DJ library source is not registered on this device"))?;
        scan_with_available_intelligence(
            &db,
            &source_id,
            &source_kind,
            &root,
            sidecar_binary.as_deref(),
            &work_root,
        )
    })
    .await
    .map_err(command_error)?
    .map_err(command_error)
}

#[tauri::command]
async fn create_local_project(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
    title: String,
) -> Result<Option<ProjectManifest>, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("Project title is required.".to_string());
    }
    let parent = app
        .dialog()
        .file()
        .set_title("Choose where to create the Ensemblis project")
        .blocking_pick_folder();
    let Some(parent) = parent else {
        return Ok(None);
    };
    let parent = parent.into_path().map_err(command_error)?;
    let package = parent.join(project::package_name(&title));
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<ProjectManifest> {
        let manifest = project::create_project(&package, &title)?;
        project::register_project(&db, &package, &manifest)?;
        Ok(manifest)
    })
    .await
    .map_err(command_error)?
    .map(Some)
    .map_err(command_error)
}

#[tauri::command]
async fn open_local_project(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
) -> Result<Option<ProjectManifest>, String> {
    let package = app
        .dialog()
        .file()
        .set_title("Choose an .ensemble project package")
        .blocking_pick_folder();
    let Some(package) = package else {
        return Ok(None);
    };
    let package = package.into_path().map_err(command_error)?;
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<ProjectManifest> {
        let manifest = project::read_manifest(&package)?;
        project::register_project(&db, &package, &manifest)?;
        Ok(manifest)
    })
    .await
    .map_err(command_error)?
    .map(Some)
    .map_err(command_error)
}

#[tauri::command]
async fn save_local_project_mutation(
    state: State<'_, BridgeState>,
    mutation: PortableProjectMutation,
    next_manifest: ProjectManifest,
) -> Result<ProjectManifest, String> {
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || {
        project_mutation::persist_project_mutation(&db, mutation, next_manifest)
    })
    .await
    .map_err(command_error)?
    .map_err(command_error)
}

#[tauri::command]
async fn choose_and_prepare_project_recording(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
    project_id: String,
) -> Result<Option<ProjectRecording>, String> {
    state
        .db
        .project_package_path(&project_id)
        .map_err(command_error)?
        .ok_or_else(|| "Project is not registered on this device.".to_string())?;
    let source = app
        .dialog()
        .file()
        .set_title("Choose audio to reference from this project")
        .blocking_pick_file();
    let Some(source) = source else {
        return Ok(None);
    };
    let source = source.into_path().map_err(command_error)?;
    let db = Arc::clone(&state.db);
    let recording_id = format!("rec_{}", Uuid::new_v4());
    tauri::async_runtime::spawn_blocking(move || {
        project::prepare_recording_binding(&db, &project_id, &recording_id, &source)
    })
    .await
    .map_err(command_error)?
    .map(Some)
    .map_err(command_error)
}

#[tauri::command]
async fn choose_and_execute_local_runtime_task(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
    task: RuntimeTask,
) -> Result<Option<LocalRuntimeTaskResult>, String> {
    if !local_processing_enabled(&state.db) {
        return Err("This device is not entitled to local processing.".to_string());
    }
    let sidecar_binary = state
        .sidecar_binary
        .clone()
        .filter(|binary| binary.is_file())
        .ok_or_else(|| "The local analysis runtime is unavailable.".to_string())?;
    let source = app
        .dialog()
        .file()
        .set_title("Choose the recording bytes for this local analysis")
        .blocking_pick_file();
    let Some(source) = source else {
        return Ok(None);
    };
    let source = source.into_path().map_err(command_error)?;
    let db = Arc::clone(&state.db);
    let work_root = state.sidecar_work_root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime_task::execute_track_planning_task(&db, &sidecar_binary, &work_root, &source, &task)
    })
    .await
    .map_err(command_error)?
    .map(Some)
    .map_err(command_error)
}

#[tauri::command]
async fn begin_browser_pairing(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
    api_base_url: String,
) -> Result<PairResponse, String> {
    let api_base_url = if api_base_url.trim().is_empty() {
        DEFAULT_API_BASE_URL.to_string()
    } else {
        api_base_url.trim().to_string()
    };
    let public_id = public_device_id(&state.db).map_err(command_error)?;
    let (listener, callback_url) =
        browser_pairing::bind_callback_listener().map_err(command_error)?;
    let browser_state = Uuid::new_v4().to_string();
    let target = browser_pairing::connect_url(&api_base_url, &callback_url, &browser_state)
        .map_err(command_error)?;
    app.opener()
        .open_url(&target, None::<&str>)
        .map_err(command_error)?;

    let db = Arc::clone(&state.db);
    let api_for_claim = api_base_url.clone();
    let public_id_for_claim = public_id.clone();
    let browser_state_for_wait = browser_state.clone();
    let paired = tauri::async_runtime::spawn_blocking(move || {
        browser_pairing::wait_for_callback(listener, &browser_state_for_wait, |pairing_code| {
            let paired = network::claim_pairing(
                &db,
                &api_for_claim,
                pairing_code,
                &public_id_for_claim,
                &default_device_name(),
                std::env::consts::OS,
                env!("CARGO_PKG_VERSION"),
            )?;
            network::refresh_device_entitlement(&db, true)?;
            Ok(paired)
        })
    })
    .await
    .map_err(command_error)?
    .map_err(command_error)?;

    let _ = app.autolaunch().enable();
    Ok(paired)
}

#[tauri::command]
async fn pair_device(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
    api_base_url: String,
    pairing_code: String,
    device_name: Option<String>,
) -> Result<PairResponse, String> {
    let public_id = public_device_id(&state.db).map_err(command_error)?;
    let name = device_name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(default_device_name);
    let db = Arc::clone(&state.db);
    let paired = tauri::async_runtime::spawn_blocking(move || {
        let paired = network::claim_pairing(
            &db,
            &api_base_url,
            &pairing_code,
            &public_id,
            &name,
            std::env::consts::OS,
            env!("CARGO_PKG_VERSION"),
        )?;
        network::refresh_device_entitlement(&db, true)?;
        Ok::<PairResponse, anyhow::Error>(paired)
    })
    .await
    .map_err(command_error)?
    .map_err(command_error)?;
    let _ = app.autolaunch().enable();
    Ok(paired)
}

#[tauri::command]
async fn refresh_desktop_entitlement(
    state: State<'_, BridgeState>,
) -> Result<EffectiveEntitlement, String> {
    let device_id = device_id(&state.db)
        .map_err(command_error)?
        .ok_or_else(|| "Pair this device before refreshing its entitlement.".to_string())?;
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<EffectiveEntitlement> {
        network::refresh_device_entitlement(&db, true)?;
        entitlements::effective_entitlement(&db, Some(&device_id))
    })
    .await
    .map_err(command_error)?
    .map_err(command_error)
}

#[tauri::command]
async fn import_desktop_license(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
) -> Result<Option<EffectiveEntitlement>, String> {
    let device_id = device_id(&state.db)
        .map_err(command_error)?
        .ok_or_else(|| "Pair this device before importing a Studio license.".to_string())?;
    let file = app
        .dialog()
        .file()
        .set_title("Choose an Ensemblis Studio license file")
        .blocking_pick_file();
    let Some(file) = file else {
        return Ok(None);
    };
    let file = file.into_path().map_err(command_error)?;
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<EffectiveEntitlement> {
        license_file::import_license_file(&db, &file, &device_id)?;
        entitlements::effective_entitlement(&db, Some(&device_id))
    })
    .await
    .map_err(command_error)?
    .map(Some)
    .map_err(command_error)
}

#[tauri::command]
fn get_execution_policy(state: State<'_, BridgeState>) -> Result<ExecutionPolicy, String> {
    execution_policy::load(&state.db).map_err(command_error)
}

#[tauri::command]
fn set_execution_policy(
    state: State<'_, BridgeState>,
    policy: ExecutionPolicy,
) -> Result<ExecutionPolicy, String> {
    execution_policy::save(&state.db, &policy).map_err(command_error)?;
    Ok(policy)
}

#[tauri::command]
async fn refresh_model_catalog(
    state: State<'_, BridgeState>,
) -> Result<Vec<ModelDescriptor>, String> {
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || model_catalog::fetch_catalog(&db))
        .await
        .map_err(command_error)?
        .map_err(command_error)
}

#[tauri::command]
async fn install_model(
    state: State<'_, BridgeState>,
    descriptor: ModelDescriptor,
) -> Result<InstalledModel, String> {
    let db = Arc::clone(&state.db);
    let model_root = state.model_root.clone();
    let device_id = device_id(&state.db).map_err(command_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        models::install_model_from_catalog(&db, device_id.as_deref(), &model_root, &descriptor)
    })
    .await
    .map_err(command_error)?
    .map_err(command_error)
}

#[tauri::command]
async fn choose_and_import_model(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
    descriptor: ModelDescriptor,
) -> Result<Option<InstalledModel>, String> {
    let source = app
        .dialog()
        .file()
        .set_title("Choose an Ensemblis model artifact to verify and import")
        .blocking_pick_file();
    let Some(source) = source else {
        return Ok(None);
    };
    let source = source.into_path().map_err(command_error)?;
    let db = Arc::clone(&state.db);
    let model_root = state.model_root.clone();
    let device_id = device_id(&state.db).map_err(command_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        models::install_model_from_file(
            &db,
            device_id.as_deref(),
            &model_root,
            &descriptor,
            &source,
        )
    })
    .await
    .map_err(command_error)?
    .map(Some)
    .map_err(command_error)
}

#[tauri::command]
async fn uninstall_model(
    state: State<'_, BridgeState>,
    id: String,
    version: String,
) -> Result<bool, String> {
    let model_root = state.model_root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        models::uninstall_model(&model_root, &id, &version)
    })
    .await
    .map_err(command_error)?
    .map_err(command_error)
}

fn sync_pending_blocking(db: &BridgeDb) -> anyhow::Result<usize> {
    let mut sent = 0;
    while sent < 20 && network::sync_next_batch(db)? {
        sent += 1;
    }
    Ok(sent)
}

#[tauri::command]
async fn sync_pending(state: State<'_, BridgeState>) -> Result<usize, String> {
    let db = Arc::clone(&state.db);
    let maintenance_lock = Arc::clone(&state.maintenance_lock);
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<usize> {
        let _guard = maintenance_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("background maintenance lock is unavailable"))?;
        sync_pending_blocking(&db)
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
    let maintenance_lock = Arc::clone(&state.maintenance_lock);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = maintenance_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("background maintenance lock is unavailable"))?;
        network::poll_and_execute_jobs(&db, sidecar_binary.as_deref(), &work_root)
    })
    .await
    .map_err(command_error)?
    .map_err(command_error)
}

#[tauri::command]
fn open_ensemblis(app: tauri::AppHandle, state: State<'_, BridgeState>) -> Result<(), String> {
    let base = state
        .db
        .get_setting("api_base_url")
        .map_err(command_error)?
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_API_BASE_URL.to_string());
    let url = Url::parse(&base)
        .and_then(|value| value.join("/studio"))
        .map_err(command_error)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(command_error)
}

#[tauri::command]
fn autostart_status(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(command_error)
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        app.autolaunch().enable().map_err(command_error)
    } else {
        app.autolaunch().disable().map_err(command_error)
    }
}

#[tauri::command]
async fn export_latest_render(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
) -> Result<Option<ExportedRender>, String> {
    let asset = export::latest_completed_render(&state.sidecar_work_root).map_err(command_error)?;
    let Some(asset) = asset else {
        return Ok(None);
    };
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
fn unpair_device(app: tauri::AppHandle, state: State<'_, BridgeState>) -> Result<(), String> {
    clear_device_credential().map_err(command_error)?;
    entitlements::clear_trust(&state.db).map_err(command_error)?;
    state
        .db
        .set_setting("device_id", "")
        .map_err(command_error)?;
    state
        .db
        .set_setting("artist_id", "")
        .map_err(command_error)?;
    let _ = app.autolaunch().disable();
    Ok(())
}

#[tauri::command]
fn privacy_contract_probe() -> serde_json::Value {
    serde_json::json!({
        "recordingIdentity": "content-sha256",
        "portableProject": project::PROJECT_FORMAT_VERSION,
        "analysisIdentity": "recording+processor+model+schema+parameters",
        "cloudFields": ["sourceTrackId", "recordingFingerprint", "metadata", "playlistIds", "cuePoints", "beatGrid", "analysisProvenance", "planningEvidence", "availability"],
        "forbiddenCloudFields": ["path", "filePath", "location", "fileUri"],
        "contractHash": hash_text("ensemblis.library-bridge.privacy.v3")
    })
}

fn start_background_maintenance(
    db: Arc<BridgeDb>,
    sidecar_binary: Option<PathBuf>,
    sidecar_work_root: PathBuf,
    maintenance_lock: Arc<Mutex<()>>,
) -> std::io::Result<()> {
    std::thread::Builder::new()
        .name("ensemblis-background-maintenance".to_string())
        .spawn(move || {
            loop {
                if device_credential().ok().flatten().is_some()
                    && let Ok(_guard) = maintenance_lock.lock()
                {
                    let _ = sync_pending_blocking(&db);
                    let _ = network::poll_and_execute_jobs(
                        &db,
                        sidecar_binary.as_deref(),
                        &sidecar_work_root,
                    );
                }
                std::thread::sleep(BACKGROUND_MAINTENANCE_INTERVAL);
            }
        })?;
    Ok(())
}

fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Ensemblis", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .setup(|app| {
            let app_data = app.path().app_local_data_dir()?;
            let db_path = app_data.join("library-bridge.sqlite3");
            let db = Arc::new(
                BridgeDb::new(db_path.clone())
                    .map_err(|error| std::io::Error::other(error.to_string()))?,
            );
            let sidecar_binary = sidecar::bundled_sidecar_path()
                .ok()
                .filter(|path| path.is_file());
            let sidecar_work_root = app_data.join("sidecar-work");
            let model_root = app_data.join("models");
            let maintenance_lock = Arc::new(Mutex::new(()));
            let watcher = Arc::new(
                LibraryWatcher::start(
                    Arc::clone(&db),
                    sidecar_binary.clone(),
                    sidecar_work_root.clone(),
                )
                .map_err(|error| std::io::Error::other(error.to_string()))?,
            );

            let entitlement_db = Arc::clone(&db);
            std::thread::Builder::new()
                .name("ensemblis-entitlement-refresh".to_string())
                .spawn(move || {
                    let paired = entitlement_db
                        .get_setting("device_id")
                        .ok()
                        .flatten()
                        .is_some_and(|value| !value.is_empty());
                    if paired {
                        let _ = network::refresh_device_entitlement(&entitlement_db, true);
                    }
                })
                .map_err(|error| std::io::Error::other(error.to_string()))?;

            start_background_maintenance(
                Arc::clone(&db),
                sidecar_binary.clone(),
                sidecar_work_root.clone(),
                Arc::clone(&maintenance_lock),
            )?;
            install_tray(app)?;
            if std::env::args().any(|argument| argument == "--background") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            app.manage(BridgeState {
                db,
                db_path,
                watcher,
                sidecar_binary,
                sidecar_work_root,
                model_root,
                maintenance_lock,
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            bridge_status,
            choose_and_scan_source,
            rescan_source,
            create_local_project,
            open_local_project,
            save_local_project_mutation,
            choose_and_prepare_project_recording,
            choose_and_execute_local_runtime_task,
            begin_browser_pairing,
            pair_device,
            refresh_desktop_entitlement,
            import_desktop_license,
            get_execution_policy,
            set_execution_policy,
            refresh_model_catalog,
            install_model,
            choose_and_import_model,
            uninstall_model,
            sync_pending,
            poll_device_jobs,
            open_ensemblis,
            autostart_status,
            set_autostart,
            export_latest_render,
            unpair_device,
            privacy_contract_probe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ensemblis");
}
