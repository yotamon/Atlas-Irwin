import test from "node:test";
import assert from "node:assert/strict";
import { File } from "node:buffer";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const resumableSource = await readFile("lib/supabase/resumable-upload.ts", "utf8");
const compiled = ts.transpileModule(resumableSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { uploadResumableMedia } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const uploaderSource = await readFile("components/studio/media-uploader.tsx", "utf8");
const diagnosticsSource = await readFile("app/studio/media-upload-diagnostics.ts", "utf8");

const target = {
  bucketName: "media",
  storagePath: "artist/master.wav",
  token: "signed-token",
};

function browserFixture(t) {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousSessionStorage = globalThis.sessionStorage;
  const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const storage = new Map();

  globalThis.window = {
    setTimeout(callback) {
      queueMicrotask(callback);
      return 0;
    },
  };
  globalThis.sessionStorage = {
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://demo.supabase.co";

  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousSessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousSessionStorage;
    if (previousSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousSupabaseUrl;
  });

  return storage;
}

function resumeKey(file) {
  return `ensemblis:tus:${target.bucketName}:${target.storagePath}:${file.size}:${file.lastModified}`;
}

test("a temporary HEAD failure preserves the resumable session instead of silently restarting at zero", async (t) => {
  const storage = browserFixture(t);
  const file = new File([new Uint8Array(32)], "master.wav", { type: "audio/wav", lastModified: 123 });
  const uploadUrl = "https://demo.storage.supabase.co/storage/v1/upload/resumable/session-1";
  storage.set(resumeKey(file), uploadUrl);
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method });
    throw new TypeError("network unavailable");
  };

  await assert.rejects(uploadResumableMedia({ file, target }), /network unavailable/);
  assert.equal(storage.get(resumeKey(file)), uploadUrl);
  assert.deepEqual(calls.map((call) => call.method), ["HEAD"]);
});

test("a HEAD response without Upload-Offset is never misread as byte zero", async (t) => {
  const storage = browserFixture(t);
  const file = new File([new Uint8Array(32)], "master.wav", { type: "audio/wav", lastModified: 321 });
  const uploadUrl = "https://demo.storage.supabase.co/storage/v1/upload/resumable/session-missing-offset";
  storage.set(resumeKey(file), uploadUrl);
  const methods = [];

  globalThis.fetch = async (_url, init = {}) => {
    methods.push(init.method);
    if (init.method === "HEAD") return new Response(null, { status: 200 });
    throw new Error(`Unexpected request method ${init.method}`);
  };

  await assert.rejects(
    uploadResumableMedia({ file, target }),
    /did not return Upload-Offset while checking resumable upload progress/,
  );
  assert.deepEqual(methods, ["HEAD"]);
  assert.equal(storage.get(resumeKey(file)), uploadUrl);
});

test("a successful PATCH advances by the known chunk size when Upload-Offset is not readable", async (t) => {
  const storage = browserFixture(t);
  const file = new File([new Uint8Array(32)], "master.wav", { type: "audio/wav", lastModified: 654 });
  const uploadUrl = "https://demo.storage.supabase.co/storage/v1/upload/resumable/session-no-exposed-offset";
  let patchAttempts = 0;
  const progress = [];

  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === "POST") {
      return new Response(null, { status: 201, headers: { Location: uploadUrl } });
    }
    if (init.method === "PATCH") {
      patchAttempts += 1;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request method ${init.method}`);
  };

  await uploadResumableMedia({
    file,
    target,
    onProgress(value) {
      progress.push(value);
    },
  });

  assert.equal(patchAttempts, 1);
  assert.equal(progress.at(-1), 1);
  assert.equal(storage.has(resumeKey(file)), false);
});

test("automatic chunk retry is surfaced and continues from the server-confirmed offset", async (t) => {
  const storage = browserFixture(t);
  const file = new File([new Uint8Array(32)], "master.wav", { type: "audio/wav", lastModified: 456 });
  const uploadUrl = "https://demo.storage.supabase.co/storage/v1/upload/resumable/session-2";
  let patchAttempts = 0;
  const retries = [];
  const progress = [];

  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === "POST") {
      return new Response(null, { status: 201, headers: { Location: uploadUrl } });
    }
    if (init.method === "PATCH") {
      patchAttempts += 1;
      if (patchAttempts === 1) throw new TypeError("connection dropped");
      return new Response(null, { status: 204, headers: { "Upload-Offset": String(file.size) } });
    }
    if (init.method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Upload-Offset": "0" } });
    }
    throw new Error(`Unexpected request method ${init.method}`);
  };

  await uploadResumableMedia({
    file,
    target,
    onProgress(value) {
      progress.push(value);
    },
    onRetry(retry) {
      retries.push(retry);
    },
  });

  assert.equal(patchAttempts, 2);
  assert.deepEqual(retries, [{ attempt: 1, delayMs: 3000 }]);
  assert.equal(progress.at(-1), 1);
  assert.equal(storage.has(resumeKey(file)), false);
});

test("large uploads automatically switch to a fresh signed standard upload after TUS exhausts retries", () => {
  assert.match(uploaderSource, /fallbackAttempted = true/);
  assert.match(uploaderSource, /Resumable route interrupted\. Finishing with secure direct upload…/);
  assert.match(uploaderSource, /uploadTarget = await prepareTarget\(\)/);
  assert.match(uploaderSource, /await uploadSignedStandard\(uploadTarget\)/);
  assert.match(uploaderSource, /transport: "tus"/);
  assert.match(uploaderSource, /transport: "signed-standard"/);
  assert.match(uploaderSource, /const canResume = resumable && !transportCompleted && !fallbackAttempted && !authorizationExpired/);
  assert.match(diagnosticsSource, /\[media-upload-transport\]/);
  assert.match(diagnosticsSource, /requireStudioAdmin\(\)/);
});

test("upload UI keeps recovery states human-readable", () => {
  assert.match(uploaderSource, /state: "ready" \| "uploading" \| "paused" \| "done" \| "error"/);
  assert.match(uploaderSource, /Upload paused\. Resume to continue from where it stopped\./);
  assert.match(uploaderSource, /Connection interrupted\. Retrying…/);
  assert.match(uploaderSource, /"Resume upload"/);
  assert.match(uploaderSource, /"Start over"/);
  assert.match(uploaderSource, /humanFormat\(item\.file\)/);
  assert.doesNotMatch(uploaderSource, /last confirmed chunk/i);
  assert.doesNotMatch(uploaderSource, /Upload was interrupted after automatic retries/i);
});
