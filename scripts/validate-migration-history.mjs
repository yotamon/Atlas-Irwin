import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIGRATION_DIR = "supabase/migrations";
const MIGRATION_RE = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

export function parseMigrationPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const filename = path.posix.basename(normalized);
  const match = MIGRATION_RE.exec(filename);
  if (!match) return null;
  return { path: normalized, filename, version: match[1], name: match[2] };
}

export function parseNameStatus(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      return {
        status: parts[0],
        paths: parts.slice(1).map((value) => value.replaceAll("\\", "/")),
      };
    });
}

export function validateMigrationChanges({ basePaths, changes }) {
  const errors = [];
  const baseMigrations = basePaths.map(parseMigrationPath).filter(Boolean);
  const baseVersions = new Set(baseMigrations.map((migration) => migration.version));
  const baseNames = new Set(baseMigrations.map((migration) => migration.name));
  const maxBaseVersion = baseMigrations.reduce(
    (max, migration) => (migration.version > max ? migration.version : max),
    "00000000000000",
  );

  const added = [];
  for (const change of changes) {
    const status = change.status[0];
    if (status === "A" && change.paths.length === 1) {
      const migration = parseMigrationPath(change.paths[0]);
      if (!migration) {
        errors.push(`Invalid migration filename: ${change.paths[0]}`);
      } else {
        added.push(migration);
      }
      continue;
    }

    errors.push(
      `Existing migration history is immutable: ${change.status} ${change.paths.join(" -> ")}`,
    );
  }

  const addedVersions = new Set();
  const addedNames = new Set();
  for (const migration of added) {
    if (baseVersions.has(migration.version) || addedVersions.has(migration.version)) {
      errors.push(`Duplicate migration timestamp: ${migration.version} (${migration.filename})`);
    }
    if (baseNames.has(migration.name) || addedNames.has(migration.name)) {
      errors.push(`Duplicate migration name: ${migration.name} (${migration.filename})`);
    }
    if (migration.version <= maxBaseVersion) {
      errors.push(
        `New migration ${migration.filename} must be newer than existing max ${maxBaseVersion}`,
      );
    }
    addedVersions.add(migration.version);
    addedNames.add(migration.name);
  }

  return { errors, added, maxBaseVersion };
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function validateRepositoryMigrationHistory(baseRef) {
  const basePaths = git(["ls-tree", "-r", "--name-only", baseRef, "--", MIGRATION_DIR])
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const changes = parseNameStatus(
    git(["diff", "--name-status", "--find-renames", `${baseRef}...HEAD`, "--", MIGRATION_DIR]),
  );
  return validateMigrationChanges({ basePaths, changes });
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run() {
  const baseRef = readArg("--base-ref") || process.env.MIGRATION_BASE_REF || "origin/main";
  try {
    const result = validateRepositoryMigrationHistory(baseRef);
    if (result.errors.length > 0) {
      for (const error of result.errors) console.error(`::error::${error}`);
      process.exit(1);
    }

    if (result.added.length === 0) {
      console.log("Migration history guard: no migration files added.");
      return;
    }

    console.log(
      `Migration history guard: ${result.added.length} append-only migration(s) accepted after ${result.maxBaseVersion}.`,
    );
    for (const migration of result.added) console.log(`- ${migration.filename}`);
  } catch (error) {
    console.error(
      `::error::Migration history guard could not verify ${baseRef}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
