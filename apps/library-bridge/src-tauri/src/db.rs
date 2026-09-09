use crate::model::{
    CloudTrackDelta, DEVICE_SYNC_VERSION, ScanSummary, ScannedTrack, SourceDelta, SyncEnvelope,
};
use anyhow::Context;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone)]
pub struct BridgeDb {
    path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct LocalBinding {
    pub path: PathBuf,
    pub recording_fingerprint: String,
}

#[derive(Debug, Clone)]
pub struct PendingOutbox {
    pub id: i64,
    pub envelope: SyncEnvelope,
}

impl BridgeDb {
    pub fn new(path: PathBuf) -> anyhow::Result<Self> {
        let db = Self { path };
        db.initialize()?;
        Ok(db)
    }

    fn open(&self) -> anyhow::Result<Connection> {
        let connection = Connection::open(&self.path)
            .with_context(|| format!("could not open bridge database {}", self.path.display()))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        Ok(connection)
    }

    fn initialize(&self) -> anyhow::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = self.open()?;
        connection.execute_batch(
            r#"
            create table if not exists settings (
              key text primary key,
              value text not null
            );

            create table if not exists sources (
              source_id text primary key,
              source_kind text not null,
              root_path text not null,
              scan_revision text,
              synced_revision text,
              updated_at text not null default current_timestamp
            );

            create table if not exists recordings (
              recording_fingerprint text primary key,
              file_size integer not null,
              first_seen_at text not null default current_timestamp,
              last_seen_at text not null default current_timestamp
            );

            -- Raw filesystem paths live only in this device-local table.
            create table if not exists file_bindings (
              source_id text not null references sources(source_id) on delete cascade,
              source_track_id text not null,
              recording_fingerprint text not null references recordings(recording_fingerprint),
              path text not null,
              file_size integer not null,
              modified_unix_ms integer not null,
              payload_hash text not null,
              cloud_json text not null,
              primary key (source_id, source_track_id)
            );
            create unique index if not exists file_bindings_path_idx
              on file_bindings(source_id, path);

            -- The last cloud-acknowledged path-free state, used for delta calculation.
            create table if not exists sync_state (
              source_id text not null,
              source_track_id text not null,
              payload_hash text not null,
              primary key (source_id, source_track_id)
            );

            create table if not exists outbox (
              id integer primary key autoincrement,
              source_id text not null,
              target_revision text not null,
              payload_json text not null,
              state_json text not null,
              status text not null default 'pending' check (status in ('pending','sent','superseded')),
              created_at text not null default current_timestamp,
              sent_at text,
              unique (source_id, target_revision)
            );
            create index if not exists outbox_pending_idx on outbox(status, id);

            create table if not exists device_jobs (
              cloud_job_id text primary key,
              idempotency_key text not null unique,
              job_type text not null,
              status text not null check (status in ('received','running','completed','failed')),
              payload_json text not null,
              result_json text,
              updated_at text not null default current_timestamp
            );
            "#,
        )?;
        Ok(())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> anyhow::Result<()> {
        self.open()?.execute(
            "insert into settings(key,value) values (?1,?2) on conflict(key) do update set value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> anyhow::Result<Option<String>> {
        Ok(self
            .open()?
            .query_row(
                "select value from settings where key=?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn source_count(&self) -> anyhow::Result<usize> {
        let count: i64 = self
            .open()?
            .query_row("select count(*) from sources", [], |row| row.get(0))?;
        Ok(count.max(0) as usize)
    }

    pub fn pending_outbox_count(&self) -> anyhow::Result<usize> {
        let count: i64 = self.open()?.query_row(
            "select count(*) from outbox where status='pending'",
            [],
            |row| row.get(0),
        )?;
        Ok(count.max(0) as usize)
    }

    pub fn source_root(&self, source_id: &str) -> anyhow::Result<Option<(String, PathBuf)>> {
        Ok(self
            .open()?
            .query_row(
                "select source_kind,root_path from sources where source_id=?1",
                params![source_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        PathBuf::from(row.get::<_, String>(1)?),
                    ))
                },
            )
            .optional()?)
    }

    pub fn cached_fingerprint(
        &self,
        source_id: &str,
        path: &Path,
        size: u64,
        modified_unix_ms: i64,
    ) -> anyhow::Result<Option<String>> {
        let path = path.to_string_lossy();
        Ok(self
            .open()?
            .query_row(
                "select recording_fingerprint from file_bindings where source_id=?1 and path=?2 and file_size=?3 and modified_unix_ms=?4",
                params![source_id, path.as_ref(), size as i64, modified_unix_ms],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn persist_scan(
        &self,
        source_id: &str,
        source_kind: &str,
        root: &Path,
        revision: &str,
        tracks: &[ScannedTrack],
    ) -> anyhow::Result<ScanSummary> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        let synced_revision: Option<String> = transaction
            .query_row(
                "select synced_revision from sources where source_id=?1",
                params![source_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();

        let mut previous = HashMap::<String, String>::new();
        {
            let mut statement = transaction.prepare(
                "select source_track_id,payload_hash from sync_state where source_id=?1",
            )?;
            let rows =
                statement.query_map(params![source_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
            for row in rows {
                let (track_id, payload_hash): (String, String) = row?;
                previous.insert(track_id, payload_hash);
            }
        }

        let current: HashMap<&str, &str> = tracks
            .iter()
            .map(|track| {
                (
                    track.cloud.source_track_id.as_str(),
                    track.payload_hash.as_str(),
                )
            })
            .collect();
        let changed_tracks: Vec<CloudTrackDelta> = tracks
            .iter()
            .filter(|track| previous.get(&track.cloud.source_track_id) != Some(&track.payload_hash))
            .map(|track| track.cloud.clone())
            .collect();
        let removed_source_track_ids: Vec<String> = previous
            .keys()
            .filter(|track_id| !current.contains_key(track_id.as_str()))
            .cloned()
            .collect();

        transaction.execute(
            "insert into sources(source_id,source_kind,root_path,scan_revision,synced_revision) values (?1,?2,?3,?4,?5)
             on conflict(source_id) do update set source_kind=excluded.source_kind,root_path=excluded.root_path,scan_revision=excluded.scan_revision,updated_at=current_timestamp",
            params![
                source_id,
                source_kind,
                root.to_string_lossy().as_ref(),
                revision,
                synced_revision
            ],
        )?;
        transaction.execute(
            "delete from file_bindings where source_id=?1",
            params![source_id],
        )?;

        for track in tracks {
            transaction.execute(
                "insert into recordings(recording_fingerprint,file_size) values (?1,?2)
                 on conflict(recording_fingerprint) do update set file_size=excluded.file_size,last_seen_at=current_timestamp",
                params![track.cloud.recording_fingerprint, track.file_size as i64],
            )?;
            transaction.execute(
                "insert into file_bindings(source_id,source_track_id,recording_fingerprint,path,file_size,modified_unix_ms,payload_hash,cloud_json)
                 values (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    source_id,
                    track.cloud.source_track_id,
                    track.cloud.recording_fingerprint,
                    track.path.to_string_lossy().as_ref(),
                    track.file_size as i64,
                    track.modified_unix_ms,
                    track.payload_hash,
                    serde_json::to_string(&track.cloud)?,
                ],
            )?;
        }

        let needs_sync = synced_revision.as_deref() != Some(revision)
            || !changed_tracks.is_empty()
            || !removed_source_track_ids.is_empty();
        if needs_sync {
            let envelope = SyncEnvelope {
                version: DEVICE_SYNC_VERSION.to_string(),
                delta: SourceDelta {
                    source_id: source_id.to_string(),
                    source_kind: source_kind.to_string(),
                    base_revision: synced_revision.clone(),
                    target_revision: revision.to_string(),
                    changed_tracks: changed_tracks.clone(),
                    removed_source_track_ids: removed_source_track_ids.clone(),
                },
            };
            let state = tracks.iter().fold(Map::new(), |mut state, track| {
                state.insert(
                    track.cloud.source_track_id.clone(),
                    Value::String(track.payload_hash.clone()),
                );
                state
            });
            // A newer unsent scan supersedes an older one. Both are relative to the last
            // acknowledged cloud revision, so sending only the newest pending batch is safe.
            transaction.execute(
                "update outbox set status='superseded' where source_id=?1 and status='pending'",
                params![source_id],
            )?;
            transaction.execute(
                "insert into outbox(source_id,target_revision,payload_json,state_json,status) values (?1,?2,?3,?4,'pending')
                 on conflict(source_id,target_revision) do update set payload_json=excluded.payload_json,state_json=excluded.state_json,status='pending',sent_at=null",
                params![
                    source_id,
                    revision,
                    serde_json::to_string(&envelope)?,
                    Value::Object(state).to_string()
                ],
            )?;
        }

        transaction.commit()?;
        Ok(ScanSummary {
            source_id: source_id.to_string(),
            source_kind: source_kind.to_string(),
            revision: revision.to_string(),
            track_count: tracks.len(),
            changed_count: changed_tracks.len(),
            removed_count: removed_source_track_ids.len(),
            queued_for_sync: needs_sync,
        })
    }

    pub fn next_outbox(&self) -> anyhow::Result<Option<PendingOutbox>> {
        let value: Option<(i64, String)> = self
            .open()?
            .query_row(
                "select id,payload_json from outbox where status='pending' order by id asc limit 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        value
            .map(|(id, payload)| {
                Ok(PendingOutbox {
                    id,
                    envelope: serde_json::from_str(&payload)?,
                })
            })
            .transpose()
    }

    pub fn acknowledge_outbox(&self, id: i64) -> anyhow::Result<()> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        let row: (String, String, String) = transaction.query_row(
            "select source_id,target_revision,state_json from outbox where id=?1 and status='pending'",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        let state: Map<String, Value> = serde_json::from_str::<Value>(&row.2)?
            .as_object()
            .cloned()
            .context("invalid local sync state")?;
        transaction.execute("delete from sync_state where source_id=?1", params![row.0])?;
        for (track_id, hash) in state {
            let hash = hash.as_str().context("invalid local payload hash")?;
            transaction.execute(
                "insert into sync_state(source_id,source_track_id,payload_hash) values (?1,?2,?3)",
                params![row.0, track_id, hash],
            )?;
        }
        transaction.execute(
            "update sources set synced_revision=?2,updated_at=current_timestamp where source_id=?1",
            params![row.0, row.1],
        )?;
        transaction.execute(
            "update outbox set status='sent',sent_at=current_timestamp where id=?1",
            params![id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn resolve_binding(
        &self,
        source_id: &str,
        source_track_id: &str,
    ) -> anyhow::Result<Option<LocalBinding>> {
        Ok(self
            .open()?
            .query_row(
                "select path,recording_fingerprint from file_bindings where source_id=?1 and source_track_id=?2",
                params![source_id, source_track_id],
                |row| {
                    Ok(LocalBinding {
                        path: PathBuf::from(row.get::<_, String>(0)?),
                        recording_fingerprint: row.get(1)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn remember_job(
        &self,
        id: &str,
        idempotency_key: &str,
        job_type: &str,
        payload: &Value,
    ) -> anyhow::Result<bool> {
        let changed = self.open()?.execute(
            "insert or ignore into device_jobs(cloud_job_id,idempotency_key,job_type,status,payload_json) values (?1,?2,?3,'received',?4)",
            params![id, idempotency_key, job_type, payload.to_string()],
        )?;
        Ok(changed > 0)
    }

    pub fn complete_job(
        &self,
        id: &str,
        status: &str,
        result: Option<&Value>,
    ) -> anyhow::Result<()> {
        self.open()?.execute(
            "update device_jobs set status=?2,result_json=?3,updated_at=current_timestamp where cloud_job_id=?1",
            params![id, status, result.map(Value::to_string)],
        )?;
        Ok(())
    }
}
