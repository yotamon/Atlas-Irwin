import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseMigrationPath } from "./validate-migration-history.mjs";

const MIGRATION_DIR = "supabase/migrations";

export function readLocalMigrations(dir = MIGRATION_DIR) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => parseMigrationPath(path.posix.join(MIGRATION_DIR, entry.name)))
    .filter(Boolean)
    .sort((a, b) => a.version.localeCompare(b.version));
}

export function compareMigrationHistory(local, remote, { allowPending = false } = {}) {
  const errors = [];
  const sharedLength = Math.min(local.length, remote.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const localMigration = local[index];
    const remoteMigration = remote[index];
    if (localMigration.version !== String(remoteMigration.version)) {
      errors.push(
        `Migration version mismatch at #${index + 1}: local ${localMigration.version}_${localMigration.name}, remote ${remoteMigration.version}_${remoteMigration.name}`,
      );
      break;
    }
    if (localMigration.name !== remoteMigration.name) {
      errors.push(
        `Migration name mismatch for ${localMigration.version}: local ${localMigration.name}, remote ${remoteMigration.name}`,
      );
      break;
    }
  }

  if (remote.length > local.length) {
    for (const migration of remote.slice(local.length)) {
      errors.push(`Remote-only migration: ${migration.version}_${migration.name}`);
    }
  }

  const pending = local.slice(remote.length);
  if (!allowPending && pending.length > 0) {
    for (const migration of pending) errors.push(`Local-only migration: ${migration.version}_${migration.name}`);
  }

  return { errors, pending };
}

export async function fetchRemoteMigrations({ projectRef, token }) {
  if (!projectRef) throw new Error("SUPABASE_PROJECT_ID is required");
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required");

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/migrations`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`Supabase migration history request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Supabase migration history response was not an array");
  }

  return payload.map((migration) => ({
    version: String(migration.version),
    name: String(migration.name),
  }));
}

function hasArg(name) {
  return process.argv.includes(name);
}

async function run() {
  try {
    const local = readLocalMigrations();
    const remote = await fetchRemoteMigrations({
      projectRef: process.env.SUPABASE_PROJECT_ID,
      token: process.env.SUPABASE_ACCESS_TOKEN,
    });
    const result = compareMigrationHistory(local, remote, {
      allowPending: hasArg("--allow-pending"),
    });

    if (result.errors.length > 0) {
      for (const error of result.errors) console.error(`::error::${error}`);
      process.exit(1);
    }

    if (result.pending.length > 0) {
      console.log(
        `Migration parity: remote is an exact prefix with ${result.pending.length} pending migration(s).`,
      );
      for (const migration of result.pending) {
        console.log(`- ${migration.version}_${migration.name}`);
      }
    } else {
      console.log(`Migration parity: exact (${local.length} migrations).`);
    }
  } catch (error) {
    console.error(
      `::error::Migration parity check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
