import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Ensemblis login never exposes or infers the configured administrator identity", async () => {
  const login = await readFile("app/studio/login/page.tsx", "utf8");
  const actions = await readFile("app/studio/login-actions.ts", "utf8");

  assert.ok(login.includes("EnsemblisMark"));
  assert.ok(login.includes("ENSEMBLIS_PRODUCT"));
  assert.equal(login.includes("adminEmails"), false);
  assert.equal(login.includes("defaultValue"), false);
  assert.equal(login.includes("Atlas Irwin"), false);

  assert.equal(actions.includes('import { adminEmails }'), false);
  assert.equal(actions.includes("adminEmails()[0]"), false);
  assert.ok(actions.includes('const email = value(form, "email").toLowerCase()'));
  assert.ok(actions.includes("This account does not have access to Ensemblis."));
  assert.equal(actions.includes("approved Studio administrator"), false);
});

test("setup and recovery state is an Ensemblis product surface", async () => {
  const setup = await readFile("app/studio/setup/page.tsx", "utf8");

  assert.ok(setup.includes("EnsemblisMark"));
  assert.ok(setup.includes("ENSEMBLIS_PRODUCT"));
  assert.ok(setup.includes("Configure Ensemblis"));
  assert.ok(setup.includes("Open Ensemblis"));
  assert.equal(setup.includes("atlas-irwin-logo-sign.svg"), false);
  assert.equal(setup.includes('alt="Atlas Irwin"'), false);
  assert.equal(/\bAtlas Irwin\b/.test(setup), false);
});
