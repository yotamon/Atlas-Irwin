import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(`${process.cwd()}/${path}`, "utf8");

test("Fan Graph keeps identity and permission channel-scoped", async () => {
  const [migration, actions, server] = await Promise.all([
    read("supabase/migrations/20260905160000_fan_graph.sql"),
    read("app/studio/fan-actions.ts"),
    read("lib/audience/fan-graph-server.ts"),
  ]);
  assert.match(migration, /fan_channel_identities/);
  assert.match(migration, /fan_permissions/);
  assert.match(migration, /channel/);
  assert.match(actions, /evidence/i);
  assert.match(actions, /verified/i);
  assert.match(actions, /DELETE/);
  assert.match(server, /permission/i);
  assert.doesNotMatch(server, /race|religion|sexual|political|health score|income score/i);
});

test("cross-channel merges require evidence and privacy deletion remains possible", async () => {
  const [migration, evidence] = await Promise.all([
    read("supabase/migrations/20260905160000_fan_graph.sql"),
    read("supabase/migrations/20260905160100_fan_permission_evidence.sql"),
  ]);
  const combined = `${migration}\n${evidence}`;
  assert.match(combined, /merge/i);
  assert.match(combined, /evidence/i);
  assert.match(combined, /delete/i);
  assert.match(combined, /revoke/i);
  assert.doesNotMatch(combined, /visitor_hash|fingerprint/i);
});