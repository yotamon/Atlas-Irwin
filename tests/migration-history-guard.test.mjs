import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMigrationPath,
  parseNameStatus,
  validateMigrationChanges,
} from "../scripts/validate-migration-history.mjs";
import { compareMigrationHistory } from "../scripts/check-supabase-migration-parity.mjs";
import { classifyMigrationRecovery } from "../scripts/audit-supabase-migration-recovery.mjs";

const basePaths = [
  "supabase/migrations/20260901000000_first.sql",
  "supabase/migrations/20260902000000_second.sql",
];

test("parses canonical migration filenames", () => {
  assert.deepEqual(parseMigrationPath("supabase/migrations/20260903000000_new_feature.sql"), {
    path: "supabase/migrations/20260903000000_new_feature.sql",
    filename: "20260903000000_new_feature.sql",
    version: "20260903000000",
    name: "new_feature",
  });
  assert.equal(parseMigrationPath("supabase/migrations/not-a-migration.sql"), null);
});

test("accepts only append-only new migrations", () => {
  const result = validateMigrationChanges({
    basePaths,
    changes: parseNameStatus("A\tsupabase/migrations/20260903000000_third.sql"),
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.added.length, 1);
});

test("rejects edits, deletes, and renames of existing migrations", () => {
  for (const diff of [
    "M\tsupabase/migrations/20260902000000_second.sql",
    "D\tsupabase/migrations/20260902000000_second.sql",
    "R100\tsupabase/migrations/20260902000000_second.sql\tsupabase/migrations/20260902000001_second.sql",
  ]) {
    const result = validateMigrationChanges({ basePaths, changes: parseNameStatus(diff) });
    assert.match(result.errors[0], /immutable/);
  }
});

test("rejects backdated and duplicate logical migrations", () => {
  const result = validateMigrationChanges({
    basePaths,
    changes: parseNameStatus(
      [
        "A\tsupabase/migrations/20260831000000_backdated.sql",
        "A\tsupabase/migrations/20260903000000_second.sql",
      ].join("\n"),
    ),
  });
  assert.ok(result.errors.some((error) => error.includes("must be newer")));
  assert.ok(result.errors.some((error) => error.includes("Duplicate migration name")));
});

test("predeploy parity allows only an exact local suffix", () => {
  const local = [
    { version: "1", name: "one" },
    { version: "2", name: "two" },
    { version: "3", name: "three" },
  ];
  const remote = [
    { version: "1", name: "one" },
    { version: "2", name: "two" },
  ];
  const result = compareMigrationHistory(local, remote, { allowPending: true });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.pending, [{ version: "3", name: "three" }]);
});

test("parity fails closed on a divergent or remote-only history", () => {
  const local = [
    { version: "1", name: "one" },
    { version: "2", name: "two" },
  ];
  const divergent = compareMigrationHistory(
    local,
    [
      { version: "1", name: "one" },
      { version: "9", name: "two" },
    ],
    { allowPending: true },
  );
  assert.match(divergent.errors[0], /version mismatch/);

  const remoteOnly = compareMigrationHistory(
    local,
    [
      { version: "1", name: "one" },
      { version: "2", name: "two" },
      { version: "3", name: "three" },
    ],
    { allowPending: true },
  );
  assert.ok(remoteOnly.errors.some((error) => error.includes("Remote-only")));
});

test("postdeploy parity requires exact equality", () => {
  const local = [
    { version: "1", name: "one" },
    { version: "2", name: "two" },
  ];
  const result = compareMigrationHistory(local, [{ version: "1", name: "one" }]);
  assert.deepEqual(result.errors, ["Local-only migration: 2_two"]);
});

test("recovery audit separates exact, tracking-only, missing SQL, and remote-only migrations", () => {
  const local = [
    { version: "100", name: "one" },
    { version: "200", name: "two" },
    { version: "300", name: "three" },
  ];
  const remote = [
    { version: "100", name: "one" },
    { version: "250", name: "two" },
    { version: "275", name: "production_repair" },
  ];

  const result = classifyMigrationRecovery(local, remote);
  assert.deepEqual(result.exact, [{ version: "100", name: "one" }]);
  assert.deepEqual(result.trackingOnly, [
    { name: "two", canonicalVersion: "200", remoteVersion: "250" },
  ]);
  assert.deepEqual(result.missingSql, [{ version: "300", name: "three" }]);
  assert.deepEqual(result.remoteOnly, [{ version: "275", name: "production_repair" }]);
  assert.equal(result.hasAmbiguity, false);
});

test("recovery audit fails closed on duplicate names and same-version collisions", () => {
  const result = classifyMigrationRecovery(
    [
      { version: "100", name: "one" },
      { version: "200", name: "two" },
    ],
    [
      { version: "100", name: "unexpected" },
      { version: "150", name: "one" },
      { version: "175", name: "one" },
    ],
  );

  assert.equal(result.hasAmbiguity, true);
  assert.equal(result.ambiguousNames.length, 1);
  assert.deepEqual(result.versionCollisions, [
    { version: "100", canonicalName: "one", remoteName: "unexpected" },
  ]);
});
