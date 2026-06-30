import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

const ENV_FILES = {
  production: ".env.vercel-production",
  preview: ".env.vercel-preview",
};

const SKIP_KEYS = new Set([
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "TURBO_CACHE",
  "TURBO_DOWNLOAD_LOCAL_ENABLED",
  "TURBO_REMOTE_ONLY",
  "TURBO_RUN_SUMMARY",
  "NX_DAEMON",
  "VERCEL_GIT_COMMIT_AUTHOR_LOGIN",
  "VERCEL_GIT_COMMIT_AUTHOR_NAME",
  "VERCEL_GIT_COMMIT_MESSAGE",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_GIT_PREVIOUS_SHA",
  "VERCEL_GIT_PROVIDER",
  "VERCEL_GIT_PULL_REQUEST_ID",
  "VERCEL_GIT_REPO_ID",
  "VERCEL_GIT_REPO_OWNER",
  "VERCEL_GIT_REPO_SLUG",
  "VERCEL_TARGET_ENV",
  "VERCEL_OIDC_TOKEN",
]);

function pullVercelEnv(environment, outputPath) {
  execFileSync(
    "vercel env pull " +
      JSON.stringify(outputPath) +
      " --environment " +
      environment +
      " --yes",
    { stdio: "inherit", shell: true },
  );
}

function parseEnvFile(path) {
  const values = new Map();
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function loadExisting(path) {
  try {
    return parseEnvFile(path);
  } catch {
    return new Map();
  }
}

console.log("Pulling Vercel environment variables...");
pullVercelEnv("production", ENV_FILES.production);
pullVercelEnv("preview", ENV_FILES.preview);

const merged = loadExisting(".env.local");
const production = parseEnvFile(ENV_FILES.production);
const preview = parseEnvFile(ENV_FILES.preview);

for (const source of [production, preview]) {
  for (const [key, value] of source.entries()) {
    if (SKIP_KEYS.has(key)) continue;
    if (!merged.has(key) || value) {
      merged.set(key, value || merged.get(key) || "");
    }
  }
}

const lines = [
  "# Restored from Vercel (production + preview). Regenerate: npm run env:restore",
  "# Sensitive secrets are blank here — Vercel does not export them via CLI/API.",
  "# Reveal them in Vercel → Project Settings → Environment Variables, then paste below.",
  "",
];

const missing = [];
for (const [key, value] of [...merged.entries()].sort()) {
  lines.push(`${key}=${JSON.stringify(value)}`);
  if (!value) missing.push(key);
}

writeFileSync(".env.local", `${lines.join("\n")}\n`);

console.log(`\nWrote ${merged.size} variables to .env.local`);
console.log(`Recovered with values: ${merged.size - missing.length}`);
if (missing.length) {
  console.log("\nStill missing (copy from Vercel dashboard):");
  for (const key of missing) console.log(`  - ${key}`);
}

for (const file of Object.values(ENV_FILES)) {
  try {
    unlinkSync(file);
  } catch {
    // ignore
  }
}
