use crate::{db::BridgeDb, scanner};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::Duration,
};

const WATCHED_SOURCES_SETTING: &str = "watched_sources_v1";
const EVENT_DEBOUNCE: Duration = Duration::from_secs(2);
const PERIODIC_RECONCILIATION: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct WatchedSource {
    source_id: String,
    source_kind: String,
    root_path: PathBuf,
}

pub struct LibraryWatcher {
    watcher: Arc<Mutex<RecommendedWatcher>>,
    sources: Arc<Mutex<Vec<WatchedSource>>>,
    db: Arc<BridgeDb>,
}

impl LibraryWatcher {
    pub fn start(db: Arc<BridgeDb>) -> anyhow::Result<Self> {
        let sources = Arc::new(Mutex::new(load_sources(&db)?));
        let (event_tx, event_rx) = mpsc::channel::<()>();
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if event.is_ok() {
                let _ = event_tx.send(());
            }
        })?;
        let watcher = Arc::new(Mutex::new(watcher));

        ensure_watches(&watcher, &sources);
        spawn_event_reconciler(Arc::clone(&db), Arc::clone(&watcher), Arc::clone(&sources), event_rx);
        spawn_periodic_reconciler(Arc::clone(&db), Arc::clone(&watcher), Arc::clone(&sources));

        Ok(Self { watcher, sources, db })
    }

    pub fn register_source(&self, source_id: &str, source_kind: &str, root: &Path) -> anyhow::Result<()> {
        let mut sources = self.sources.lock().map_err(|_| anyhow::anyhow!("watch source registry is unavailable"))?;
        if let Some(existing) = sources.iter_mut().find(|source| source.source_id == source_id) {
            existing.source_kind = source_kind.to_string();
            existing.root_path = root.to_path_buf();
        } else {
            sources.push(WatchedSource {
                source_id: source_id.to_string(),
                source_kind: source_kind.to_string(),
                root_path: root.to_path_buf(),
            });
        }
        persist_sources(&self.db, &sources)?;
        if root.is_dir() {
            let mut watcher = self.watcher.lock().map_err(|_| anyhow::anyhow!("filesystem watcher is unavailable"))?;
            let _ = watcher.watch(root, RecursiveMode::Recursive);
        }
        Ok(())
    }
}

fn load_sources(db: &BridgeDb) -> anyhow::Result<Vec<WatchedSource>> {
    let Some(value) = db.get_setting(WATCHED_SOURCES_SETTING)? else {
        return Ok(Vec::new());
    };
    if value.trim().is_empty() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&value).unwrap_or_default())
}

fn persist_sources(db: &BridgeDb, sources: &[WatchedSource]) -> anyhow::Result<()> {
    db.set_setting(WATCHED_SOURCES_SETTING, &serde_json::to_string(sources)?)
}

fn snapshot_sources(sources: &Arc<Mutex<Vec<WatchedSource>>>) -> Vec<WatchedSource> {
    sources.lock().map(|value| value.clone()).unwrap_or_default()
}

fn ensure_watches(
    watcher: &Arc<Mutex<RecommendedWatcher>>,
    sources: &Arc<Mutex<Vec<WatchedSource>>>,
) {
    let snapshot = snapshot_sources(sources);
    let Ok(mut watcher) = watcher.lock() else { return };
    for source in snapshot {
        if source.root_path.is_dir() {
            let _ = watcher.watch(&source.root_path, RecursiveMode::Recursive);
        }
    }
}

fn reconcile(db: &BridgeDb, sources: &Arc<Mutex<Vec<WatchedSource>>>) {
    for source in snapshot_sources(sources) {
        // A missing/unmounted drive is not interpreted as track deletion. The last synchronized
        // cloud evidence remains intact until the root becomes available and reconciliation succeeds.
        if !source.root_path.is_dir() {
            continue;
        }
        let _ = scanner::scan_source(db, &source.source_id, &source.source_kind, &source.root_path);
    }
}

fn spawn_event_reconciler(
    db: Arc<BridgeDb>,
    watcher: Arc<Mutex<RecommendedWatcher>>,
    sources: Arc<Mutex<Vec<WatchedSource>>>,
    event_rx: mpsc::Receiver<()>,
) {
    thread::Builder::new()
        .name("ensemblis-library-watch".to_string())
        .spawn(move || {
            while event_rx.recv().is_ok() {
                // Coalesce bursts from copies, tag writes and rename sequences before hashing again.
                while event_rx.recv_timeout(EVENT_DEBOUNCE).is_ok() {}
                ensure_watches(&watcher, &sources);
                reconcile(&db, &sources);
            }
        })
        .expect("could not start Library Bridge filesystem reconciliation thread");
}

fn spawn_periodic_reconciler(
    db: Arc<BridgeDb>,
    watcher: Arc<Mutex<RecommendedWatcher>>,
    sources: Arc<Mutex<Vec<WatchedSource>>>,
) {
    thread::Builder::new()
        .name("ensemblis-library-reconcile".to_string())
        .spawn(move || loop {
            thread::sleep(PERIODIC_RECONCILIATION);
            ensure_watches(&watcher, &sources);
            reconcile(&db, &sources);
        })
        .expect("could not start Library Bridge periodic reconciliation thread");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn watched_source_registry_stays_device_local() {
        let directory = tempdir().unwrap();
        let db = BridgeDb::new(directory.path().join("bridge.sqlite3")).unwrap();
        let root = directory.path().join("music");
        std::fs::create_dir_all(&root).unwrap();
        let source = WatchedSource {
            source_id: "local".to_string(),
            source_kind: "local_library".to_string(),
            root_path: root.clone(),
        };
        persist_sources(&db, std::slice::from_ref(&source)).unwrap();
        assert_eq!(load_sources(&db).unwrap(), vec![source]);
        assert!(db.get_setting(WATCHED_SOURCES_SETTING).unwrap().unwrap().contains(root.to_string_lossy().as_ref()));
    }
}
