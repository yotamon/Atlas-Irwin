import { pathToFileURL } from "node:url";
import {
  compareMigrationHistory,
  readLocalMigrations,
  fetchRemoteMigrations,
} from "./check-supabase-migration-parity.mjs";

/**
 * A manually approved production migration run must deploy exactly the expected
 * canonical batch. No forgotten migrations, no extra versions, no empty runs.
 * This is a read-only preflight; the guarded GitHub Environment remains the
 * sole authority for applying any migrations.
 */
export function verifyProductionMigrationBatch(local, remote, expectedInput) {
  const expected = String(expectedInput ?? "").split(",").map((name) => name.trim());
  if (!expected.length || expected.some((name) => !/^\d{14}_[a-z][a-z0-9_]*$/.test(name))) {
    throw new Error("Expected migrations must be nonempty, comma-separated canonical version_name values.");
  }
  if (new Set(expected).size !== expected.length) {
    throw new Error("Expected migrations must not contain duplicates.");
  }

  const result = compareMigrationHistory(local, remote, { allowPending: true });
  if (result.errors.length) {
    throw new Error(`Production migration history has drifted: ${result.errors.join("; ")}`);
  }

  const actual = result.pending.map(({ version, name }) => `${version}_${name}`);
  if (!actual.length) {
    throw new Error("No migrations remain pending. Do not run a production migration without a real batch.");
  }
  if (actual.join(",") !== expected.join(",")) {
    throw new Error(
      `Requested manual batch does not match current pending repository migrations. Expected [${expected.join(", ")}]; actual [${actual.join(", ")}]. Refresh the history before approving.`,
    );
  }
  return actual;
}

async function main() {
  const requested = process.env.EXPECTED_MIGRATIONS;
  const remote = await fetchRemoteMigrations({
    projectRef: process.env.SUPABASE_PROJECT_ID,
    token: process.env.SUPABASE_ACCESS_TOKEN,
  });
  const confirmed = verifyProductionMigrationBatch(readLocalMigrations(), remote, requested);
  console.log(`Verified exact requested production migration batch: ${confirmed.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
