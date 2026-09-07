import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("TypeScript uses the modern compilation baseline without resolver safety hacks", () => {
  const tsconfig = JSON.parse(source("tsconfig.json"));
  assert.equal(tsconfig.compilerOptions.target, "ES2022");
  assert.equal(tsconfig.compilerOptions.allowJs, false);
  assert.deepEqual(tsconfig.compilerOptions.paths, { "@/*": ["./*"] });
});

test("catalog mutations enter through the artist-scoped canonical facade", () => {
  const facade = source("app/studio/catalog-actions.ts");
  assert.match(facade, /resolveDefaultArtistContext/);
  assert.match(facade, /assertActiveArtistTargets/);
  assert.match(facade, /\.eq\("artist_id", artist\.artistId\)/);
  assert.match(facade, /from "\.\/catalog-actions-internal"/);
  assert.equal(existsSync(new URL("../app/studio/catalog-actions-safe.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../app/studio/catalog-actions-internal.ts", import.meta.url)), true);
});

test("all heavy media entrypoints dispatch through the provider boundary", () => {
  const dispatcher = source("lib/media-worker/dispatcher.ts");
  assert.match(dispatcher, /interface MediaWorkerDispatcher/);
  assert.match(dispatcher, /ENSEMBLIS_MEDIA_WORKER_PROVIDER/);
  assert.match(dispatcher, /vercel_sandbox/);
  assert.match(dispatcher, /MEDIA_WORKER_TRACE_PAYLOAD_KEY/);
  assert.match(dispatcher, /observeExecution\("media_worker\.dispatch"/);

  for (const path of [
    "lib/media-worker/queue.ts",
    "lib/mastering/jobs.ts",
    "lib/automix/jobs.ts",
  ]) {
    const contents = source(path);
    assert.match(contents, /@\/lib\/media-worker\/dispatcher/);
    assert.doesNotMatch(
      contents,
      /import\s*\{[^}]*dispatchMediaWorkerJob[^}]*\}\s*from\s*"@\/lib\/media-worker\/sandbox"/s,
    );
  }
});

test("email delivery is provider-backed by Resend and observable", () => {
  const provider = source("lib/email/provider.ts");
  const resend = source("lib/email/resend.ts");
  const contact = source("app/api/contact/route.ts");
  const env = source(".env.example");

  assert.match(provider, /ResendEmailProvider/);
  assert.match(resend, /https:\/\/api\.resend\.com\/emails/);
  assert.match(resend, /Idempotency-Key/);
  assert.match(resend, /EXECUTION_TRACE_HEADER/);
  assert.match(contact, /@\/lib\/email\/provider/);
  assert.match(contact, /from: contactSenderEmail\(\)/);
  assert.doesNotMatch(contact, /nodemailer/);
  assert.match(env, /RESEND_API_KEY=/);
  assert.match(env, /ENSEMBLIS_EMAIL_FROM=/);
  assert.doesNotMatch(env, /CONTACT_SMTP_/);
});

test("Studio contracts are discovered and browser smoke coverage is configured", () => {
  const pkg = JSON.parse(source("package.json"));
  assert.equal(pkg.scripts["test:studio"], "node scripts/run-studio-tests.mjs");
  assert.equal(pkg.scripts["test:e2e"], "playwright test --config=playwright.config.mjs");
  assert.equal(existsSync(new URL("../e2e/platform-smoke.spec.mjs", import.meta.url)), true);
});
