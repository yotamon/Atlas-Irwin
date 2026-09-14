import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  fetchRemoteMigrations,
  readLocalMigrations,
} from "./check-supabase-migration-parity.mjs";

function normalizeMigration(migration) {
  return {
    version: String(migration.version),
    name: String(migration.name),
  };
}

function migrationId(migration) {
  return `${migration.version}_${migration.name}`;
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const value = key(item);
    const existing = groups.get(value) ?? [];
    existing.push(item);
    groups.set(value, existing);
  }
  return groups;
}

export function classifyMigrationRecovery(localInput, remoteInput) {
  const local = localInput.map(normalizeMigration).sort((a, b) => a.version.localeCompare(b.version));
  const remote = remoteInput.map(normalizeMigration).sort((a, b) => a.version.localeCompare(b.version));

  const localByName = groupBy(local, (migration) => migration.name);
  const remoteByName = groupBy(remote, (migration) => migration.name);
  const localByVersion = groupBy(local, (migration) => migration.version);
  const remoteByVersion = groupBy(remote, (migration) => migration.version);

  const ambiguousNames = [];
  for (const [name, migrations] of localByName) {
    if (migrations.length > 1) ambiguousNames.push({ side: "local", name, migrations });
  }
  for (const [name, migrations] of remoteByName) {
    if (migrations.length > 1) ambiguousNames.push({ side: "remote", name, migrations });
  }

  const ambiguousVersions = [];
  for (const [version, migrations] of localByVersion) {
    if (migrations.length > 1) ambiguousVersions.push({ side: "local", version, migrations });
  }
  for (const [version, migrations] of remoteByVersion) {
    if (migrations.length > 1) ambiguousVersions.push({ side: "remote", version, migrations });
  }

  const exact = [];
  const trackingOnly = [];
  const missingHistory = [];

  for (const localMigration of local) {
    const remoteMatches = remoteByName.get(localMigration.name) ?? [];
    if (remoteMatches.length === 0) {
      missingHistory.push(localMigration);
      continue;
    }
    if (remoteMatches.length !== 1) continue;

    const remoteMigration = remoteMatches[0];
    if (remoteMigration.version === localMigration.version) {
      exact.push(localMigration);
    } else {
      trackingOnly.push({
        name: localMigration.name,
        canonicalVersion: localMigration.version,
        remoteVersion: remoteMigration.version,
      });
    }
  }

  const remoteOnly = remote.filter((migration) => !localByName.has(migration.name));

  const versionCollisions = [];
  for (const remoteMigration of remote) {
    const canonicalAtVersion = localByVersion.get(remoteMigration.version) ?? [];
    for (const localMigration of canonicalAtVersion) {
      if (localMigration.name !== remoteMigration.name) {
        versionCollisions.push({
          version: remoteMigration.version,
          canonicalName: localMigration.name,
          remoteName: remoteMigration.name,
        });
      }
    }
  }

  const hasAmbiguity =
    ambiguousNames.length > 0 || ambiguousVersions.length > 0 || versionCollisions.length > 0;

  return {
    exact,
    trackingOnly,
    missingHistory,
    remoteOnly,
    ambiguousNames,
    ambiguousVersions,
    versionCollisions,
    hasAmbiguity,
  };
}

export function validateRecoveryBaseline({ local, remote, result, baseline, projectRef }) {
  const errors = [];
  const expectedRemoteOnly = (baseline.expectedRemoteOnly ?? []).map(normalizeMigration).map(migrationId).sort();
  const actualRemoteOnly = result.remoteOnly.map(migrationId).sort();
  const expectedMissing = [...(baseline.genuineMissingSql ?? [])].map(String).sort();
  const actualMissing = result.missingHistory.map(migrationId).sort();
  const matchedRemoteNames = remote.length - result.remoteOnly.length;

  if (baseline.projectRef && baseline.projectRef !== projectRef) {
    errors.push(`Project ref changed: expected ${baseline.projectRef}, got ${projectRef}`);
  }
  if (Number(baseline.canonicalMigrationCount) !== local.length) {
    errors.push(
      `Canonical migration count changed: expected ${baseline.canonicalMigrationCount}, got ${local.length}`,
    );
  }
  if (Number(baseline.remoteMigrationCount) !== remote.length) {
    errors.push(
      `Remote migration count changed: expected ${baseline.remoteMigrationCount}, got ${remote.length}`,
    );
  }
  if (Number(baseline.matchedRemoteNames) !== matchedRemoteNames) {
    errors.push(
      `Matched remote-name count changed: expected ${baseline.matchedRemoteNames}, got ${matchedRemoteNames}`,
    );
  }
  if (JSON.stringify(expectedRemoteOnly) !== JSON.stringify(actualRemoteOnly)) {
    errors.push(
      `Remote-only set changed: expected [${expectedRemoteOnly.join(", ")}], got [${actualRemoteOnly.join(", ")}]`,
    );
  }
  if (JSON.stringify(expectedMissing) !== JSON.stringify(actualMissing)) {
    errors.push(
      `Missing-history set changed: expected [${expectedMissing.join(", ")}], got [${actualMissing.join(", ")}]`,
    );
  }

  return errors;
}

function printHumanReadable(result) {
  console.log(`Exact canonical migrations: ${result.exact.length}`);
  console.log(`Tracking-only timestamp drift: ${result.trackingOnly.length}`);
  for (const migration of result.trackingOnly) {
    console.log(
      `  TRACKING ${migration.remoteVersion}_${migration.name} -> ${migration.canonicalVersion}_${migration.name}`,
    );
  }

  console.log(`Canonical migrations missing from remote history: ${result.missingHistory.length}`);
  for (const migration of result.missingHistory) {
    console.log(`  MISSING_HISTORY ${migration.version}_${migration.name}`);
  }

  console.log(`Remote-only migrations: ${result.remoteOnly.length}`);
  for (const migration of result.remoteOnly) {
    console.log(`  REMOTE_ONLY ${migration.version}_${migration.name}`);
  }

  if (result.ambiguousNames.length > 0) {
    console.log("Ambiguous logical migration names:");
    for (const ambiguity of result.ambiguousNames) {
      console.log(
        `  ${ambiguity.side.toUpperCase()} ${ambiguity.name}: ${ambiguity.migrations
          .map((migration) => migration.version)
          .join(", ")}`,
      );
    }
  }

  if (result.ambiguousVersions.length > 0) {
    console.log("Duplicate migration versions:");
    for (const ambiguity of result.ambiguousVersions) {
      console.log(
        `  ${ambiguity.side.toUpperCase()} ${ambiguity.version}: ${ambiguity.migrations
          .map((migration) => migration.name)
          .join(", ")}`,
      );
    }
  }

  if (result.versionCollisions.length > 0) {
    console.log("Same-version/different-name collisions:");
    for (const collision of result.versionCollisions) {
      console.log(
        `  COLLISION ${collision.version}: canonical=${collision.canonicalName}, remote=${collision.remoteName}`,
      );
    }
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function run() {
  try {
    const projectRef = process.env.SUPABASE_PROJECT_ID;
    const local = readLocalMigrations();
    const remote = await fetchRemoteMigrations({
      projectRef,
      token: process.env.SUPABASE_ACCESS_TOKEN,
    });
    const result = classifyMigrationRecovery(local, remote);

    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHumanReadable(result);
    }

    const errors = [];
    if (result.hasAmbiguity) {
      errors.push("Migration recovery audit found ambiguous history. Do not repair or deploy.");
    }

    const baselinePath = argValue("--expect-baseline");
    if (baselinePath) {
      const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
      errors.push(...validateRecoveryBaseline({ local, remote, result, baseline, projectRef }));
    }

    if (errors.length > 0) {
      for (const error of errors) console.error(`::error::${error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(
      `::error::Migration recovery audit failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
