use crate::{
    db::BridgeDb,
    privacy::assert_path_free_value,
    project::{self, ProjectManifest},
};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const PROJECT_MUTATION_VERSION: &str = "ensemblis.project-mutation.v1";
const MAX_MUTATION_BYTES: usize = 256 * 1024;
const MAX_MANIFEST_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableProjectMutation {
    pub version: String,
    pub mutation_id: String,
    pub project_id: String,
    pub base_revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
    pub created_at: String,
    pub operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
    pub payload: Value,
}

fn validate_identifier(value: &str, field: &str, max: usize) -> anyhow::Result<()> {
    if value.trim().is_empty() || value.len() > max {
        anyhow::bail!("project mutation {field} is invalid");
    }
    Ok(())
}

fn validate_mutation(mutation: &PortableProjectMutation) -> anyhow::Result<()> {
    if mutation.version != PROJECT_MUTATION_VERSION {
        anyhow::bail!("unsupported project mutation version");
    }
    validate_identifier(&mutation.mutation_id, "mutationId", 200)?;
    validate_identifier(&mutation.project_id, "projectId", 160)?;
    if let Some(actor_id) = &mutation.actor_id {
        if actor_id.len() > 200 {
            anyhow::bail!("project mutation actorId is invalid");
        }
    }
    if let Some(entity_id) = &mutation.entity_id {
        validate_identifier(entity_id, "entityId", 200)?;
    }
    if !mutation.payload.is_object() {
        anyhow::bail!("project mutation payload must be an object");
    }
    if mutation.operation != "project.title.set" && mutation.entity_id.is_none() {
        anyhow::bail!("entity project mutation requires entityId");
    }
    if !matches!(
        mutation.operation.as_str(),
        "project.title.set"
            | "recording.add"
            | "recording.remove"
            | "recording.metadata.update"
            | "analysis.attach"
            | "analysis.detach"
            | "asset.attach"
            | "asset.detach"
            | "note.update"
    ) {
        anyhow::bail!("unsupported project mutation operation");
    }

    let serialized = serde_json::to_vec(mutation)?;
    if serialized.len() > MAX_MUTATION_BYTES {
        anyhow::bail!("project mutation exceeds the local 256 KiB safety budget");
    }
    assert_path_free_value(&serde_json::to_value(mutation)?, "project mutation")?;
    Ok(())
}

pub fn persist_project_mutation(
    db: &BridgeDb,
    mutation: PortableProjectMutation,
    next_manifest: ProjectManifest,
) -> anyhow::Result<ProjectManifest> {
    validate_mutation(&mutation)?;
    project::validate_manifest(&next_manifest)?;

    let serialized_manifest = serde_json::to_vec(&next_manifest)?;
    if serialized_manifest.len() > MAX_MANIFEST_BYTES {
        anyhow::bail!("portable project exceeds the local 2 MiB cloud-replica safety budget");
    }

    let package = db
        .project_package_path(&mutation.project_id)?
        .context("project is not registered on this device")?;
    let current = project::read_manifest(&package)?;

    if mutation.project_id != current.project_id
        || next_manifest.project_id != current.project_id
        || next_manifest.version != current.version
    {
        anyhow::bail!("project mutation identity does not match the registered package");
    }

    let expected_revision = mutation
        .base_revision
        .checked_add(1)
        .context("project revision overflow")?;

    // A command response can be lost after the manifest was durably replaced. Treat the exact
    // next state as an idempotent retry rather than forcing the user to reopen the project.
    if current == next_manifest && current.revision == expected_revision {
        return Ok(current);
    }

    if current.revision != mutation.base_revision {
        anyhow::bail!("project mutation is stale; reopen or rebase before saving");
    }
    if next_manifest.revision != expected_revision {
        anyhow::bail!("next project manifest revision does not match the mutation");
    }
    if next_manifest.updated_at != mutation.created_at {
        anyhow::bail!("next project manifest timestamp does not match the mutation");
    }

    project::write_manifest(&package, &next_manifest)?;
    project::register_project(db, &package, &next_manifest)?;
    Ok(next_manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project;
    use tempfile::tempdir;

    fn title_mutation(
        project_id: &str,
        base_revision: u64,
        created_at: &str,
    ) -> PortableProjectMutation {
        PortableProjectMutation {
            version: PROJECT_MUTATION_VERSION.to_string(),
            mutation_id: "mut_title_1".to_string(),
            project_id: project_id.to_string(),
            base_revision,
            actor_id: None,
            created_at: created_at.to_string(),
            operation: "project.title.set".to_string(),
            entity_id: None,
            payload: serde_json::json!({"title": "Renamed"}),
        }
    }

    #[test]
    fn persists_canonical_next_manifest_and_allows_exact_retry() {
        let directory = tempdir().unwrap();
        let package = directory.path().join("Demo.ensemble");
        let db = BridgeDb::new(directory.path().join("bridge.sqlite3")).unwrap();
        let current = project::create_project(&package, "Demo").unwrap();
        project::register_project(&db, &package, &current).unwrap();

        let created_at = "2026-09-14T00:00:00.000Z";
        let mutation = title_mutation(&current.project_id, current.revision, created_at);
        let mut next = current.clone();
        next.title = "Renamed".to_string();
        next.revision += 1;
        next.updated_at = created_at.to_string();

        let saved = persist_project_mutation(&db, mutation.clone(), next.clone()).unwrap();
        assert_eq!(saved, next);
        assert_eq!(project::read_manifest(&package).unwrap(), next);

        let retried = persist_project_mutation(&db, mutation, next.clone()).unwrap();
        assert_eq!(retried, next);
    }

    #[test]
    fn rejects_stale_or_path_bearing_mutations() {
        let directory = tempdir().unwrap();
        let package = directory.path().join("Demo.ensemble");
        let db = BridgeDb::new(directory.path().join("bridge.sqlite3")).unwrap();
        let current = project::create_project(&package, "Demo").unwrap();
        project::register_project(&db, &package, &current).unwrap();

        let created_at = "2026-09-14T00:00:00.000Z";
        let mut mutation = title_mutation(&current.project_id, current.revision + 1, created_at);
        mutation.payload =
            serde_json::json!({"title": "Renamed", "filePath": "/Users/example/private.wav"});
        let mut next = current.clone();
        next.title = "Renamed".to_string();
        next.revision += 2;
        next.updated_at = created_at.to_string();

        let error = persist_project_mutation(&db, mutation, next).unwrap_err();
        assert!(error.to_string().contains("device-local"));
    }
}
