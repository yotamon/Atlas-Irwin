import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMigrationPath,
  parseNameStatus,
  validateMigrationChanges,
} from "../scripts/validate-migration-history.mjs";
import {
  compareMigrationHistory,
  readLocalMigrations,
} from "../scripts/check-supabase-migration-parity.mjs";
import {
  classifyMigrationRecovery,
  migrationHistoryFingerprint,
  validateRecoveryBaseline,
} from "../scripts/audit-supabase-migration-recovery.mjs";

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

test("recovery audit separates exact, tracking-only, missing-history, and remote-only migrations", () => {
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
  assert.deepEqual(result.missingHistory, [{ version: "300", name: "three" }]);
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

test("strict recovery baseline accepts only the audited production shape", () => {
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
  const baseline = {
    projectRef: "project",
    canonicalMigrationCount: 3,
    remoteMigrationCount: 3,
    remoteHistoryFingerprint: migrationHistoryFingerprint(remote),
    matchedRemoteNames: 2,
    expectedRemoteOnly: [{ version: "275", name: "production_repair" }],
    genuineMissingSql: ["300_three"],
  };

  assert.deepEqual(
    validateRecoveryBaseline({ local, remote, result, baseline, projectRef: "project" }),
    [],
  );
});

test("strict recovery baseline fails if production changes after the audit", () => {
  const local = [
    { version: "100", name: "one" },
    { version: "200", name: "two" },
    { version: "300", name: "three" },
  ];
  const remote = [
    { version: "100", name: "one" },
    { version: "250", name: "two" },
    { version: "275", name: "unexpected_hotfix" },
  ];
  const result = classifyMigrationRecovery(local, remote);
  const baseline = {
    projectRef: "project",
    canonicalMigrationCount: 3,
    remoteMigrationCount: 3,
    matchedRemoteNames: 2,
    expectedRemoteOnly: [{ version: "275", name: "production_repair" }],
    genuineMissingSql: ["300_three"],
  };

  const errors = validateRecoveryBaseline({ local, remote, result, baseline, projectRef: "project" });
  assert.ok(errors.some((error) => error.includes("Remote-only set changed")));
});

test("strict recovery baseline fingerprints every remote timestamp and logical name", () => {
  const local = [
    { version: "100", name: "one" },
    { version: "200", name: "two" },
    { version: "300", name: "three" },
  ];
  const auditedRemote = [
    { version: "100", name: "one" },
    { version: "250", name: "two" },
    { version: "275", name: "production_repair" },
  ];
  const changedRemote = [
    { version: "100", name: "one" },
    { version: "251", name: "two" },
    { version: "275", name: "production_repair" },
  ];
  const result = classifyMigrationRecovery(local, changedRemote);
  const baseline = {
    projectRef: "project",
    canonicalMigrationCount: 3,
    remoteMigrationCount: 3,
    remoteHistoryFingerprint: migrationHistoryFingerprint(auditedRemote),
    matchedRemoteNames: 2,
    expectedRemoteOnly: [{ version: "275", name: "production_repair" }],
    genuineMissingSql: ["300_three"],
  };

  const errors = validateRecoveryBaseline({
    local,
    remote: changedRemote,
    result,
    baseline,
    projectRef: "project",
  });
  assert.ok(errors.some((error) => error.includes("Remote migration history changed")));
});

test("dated production recovery baseline matches the canonical migration directory", () => {
  const baseline = JSON.parse(
    fs.readFileSync(
      new URL("../scripts/fixtures/production-migration-recovery-2026-09-14.json", import.meta.url),
      "utf8",
    ),
  );
  const local = readLocalMigrations();
  const localIds = new Set(local.map((migration) => `${migration.version}_${migration.name}`));

  assert.equal(local.length, baseline.canonicalMigrationCount);
  assert.match(baseline.remoteHistoryFingerprint, /^[0-9a-f]{64}$/);
  for (const migration of baseline.genuineMissingSql) {
    assert.ok(localIds.has(migration), `Audited missing migration is no longer canonical: ${migration}`);
  }
});
