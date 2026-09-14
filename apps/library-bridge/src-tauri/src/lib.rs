mod analysis;
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
    model_root: PathBuf,
}

fn command_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn device_id(db: &BridgeDb) -> anyhow::Result<Option<String>> {
    Ok(db
        .get_setting("device_id")?
        .filter(|value| !value.is_empty()))
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
        .set_title("Choose a DJ music library folder")
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
    serde_json::json!({
        "recordingIdentity": "content-sha256",
        "portableProject": project::PROJECT_FORMAT_VERSION,
        "analysisIdentity": "recording+processor+model+schema+parameters",
        "cloudFields": ["sourceTrackId", "recordingFingerprint", "metadata", "playlistIds", "cuePoints", "beatGrid", "analysisProvenance", "planningEvidence", "availability"],
        "forbiddenCloudFields": ["path", "filePath", "location", "fileUri"],
        "contractHash": hash_text("ensemblis.library-bridge.privacy.v3")
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
            let model_root = app_data.join("models");
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
                model_root,
            });
            Ok(())
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
            pair_device,
            import_desktop_license,
            get_execution_policy,
            set_execution_policy,
            refresh_model_catalog,
            install_model,
            choose_and_import_model,
            uninstall_model,
            sync_pending,
            poll_device_jobs,
            export_latest_render,
            unpair_device,
            privacy_contract_probe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ensemblis Library Bridge");
}
