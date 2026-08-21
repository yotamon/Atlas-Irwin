import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const service = process.env.MEDIA_WORKER_SERVICE?.trim() || "atlas-media-worker";
const region = process.env.GCP_REGION?.trim() || "europe-west3";
const siteUrl = (process.env.ATLAS_SITE_URL?.trim() || "https://atlasirwin.com").replace(/\/$/, "");
const syncPreview = process.env.MEDIA_WORKER_SYNC_PREVIEW !== "false";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? ["pipe", "pipe", "inherit"] : [options.input ? "pipe" : "inherit", "inherit", "inherit"],
    input: options.input,
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  return options.capture ? result.stdout.trim() : "";
}

function commandExists(command, versionArgs = ["--version"]) {
  const result = spawnSync(command, versionArgs, {
    encoding: "utf8",
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return result.status === 0;
}

if (!commandExists("gcloud")) {
  throw new Error("Google Cloud CLI (gcloud) is required. Install it and run `gcloud auth login` first.");
}
if (!commandExists("vercel")) {
  throw new Error("Vercel CLI is required. Install it with `npm i -g vercel` and run `vercel login` first.");
}

const configuredProject = run("gcloud", ["config", "get-value", "project"], { capture: true });
const project = process.env.GCP_PROJECT_ID?.trim() || (configuredProject && configuredProject !== "(unset)" ? configuredProject : "");
if (!project) {
  throw new Error("No GCP project is configured. Set GCP_PROJECT_ID or run `gcloud config set project <PROJECT_ID>`.");
}

const secret = process.env.MEDIA_WORKER_SECRET?.trim() || randomBytes(32).toString("base64url");

console.log(`Deploying ${service} to Cloud Run (${project}/${region})...`);
run("gcloud", [
  "run", "deploy", service,
  "--project", project,
  "--source", "services/media-worker",
  "--region", region,
  "--platform", "managed",
  "--allow-unauthenticated",
  "--set-env-vars", `MEDIA_WORKER_SECRET=${secret}`,
  "--no-cpu-throttling",
  "--min-instances", "1",
  "--max-instances", "2",
  "--cpu", "4",
  "--memory", "8Gi",
  "--timeout", "900",
  "--quiet",
]);

const workerUrl = run("gcloud", [
  "run", "services", "describe", service,
  "--project", project,
  "--region", region,
  "--platform", "managed",
  "--format=value(status.url)",
], { capture: true });
if (!workerUrl.startsWith("https://")) throw new Error("Cloud Run deployed, but no HTTPS service URL was returned.");

console.log("Verifying the worker before connecting Atlas...");
const workerHealth = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(15_000) });
const workerPayload = await workerHealth.json().catch(() => ({}));
if (!workerHealth.ok || workerPayload?.version < 2) {
  throw new Error(`Cloud Run health check failed or returned an old worker version: ${JSON.stringify(workerPayload)}`);
}
if (workerPayload?.music_intelligence?.semantic_analyzer_available !== true) {
  throw new Error(`Worker v2 is running, but all-in-one-infer is unavailable: ${JSON.stringify(workerPayload)}`);
}

function setVercelEnv(name, value, environment) {
  run("vercel", ["env", "rm", name, environment, "--yes"], { input: "" });
  run("vercel", ["env", "add", name, environment], { input: `${value}\n` });
}

console.log("Connecting production Vercel to the worker...");
setVercelEnv("MEDIA_WORKER_URL", workerUrl, "production");
setVercelEnv("MEDIA_WORKER_SECRET", secret, "production");
if (syncPreview) {
  setVercelEnv("MEDIA_WORKER_URL", workerUrl, "preview");
  setVercelEnv("MEDIA_WORKER_SECRET", secret, "preview");
}

console.log("Redeploying Atlas so the new environment values take effect...");
run("vercel", ["--prod", "--yes"]);

console.log("Verifying Atlas -> Cloud Run connectivity...");
let atlasHealth = null;
for (let attempt = 1; attempt <= 24; attempt += 1) {
  try {
    const response = await fetch(`${siteUrl}/api/health/media-worker`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    atlasHealth = await response.json().catch(() => null);
    if (response.ok && atlasHealth?.music_intelligence_v2 && atlasHealth?.semantic_analyzer_available) break;
  } catch {
    // Production may still be switching aliases. Retry below.
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}

if (!atlasHealth?.music_intelligence_v2 || !atlasHealth?.semantic_analyzer_available) {
  throw new Error(`Atlas did not become healthy after deployment: ${JSON.stringify(atlasHealth)}`);
}

console.log("\nMedia Worker production deployment is healthy.");
console.log(`Cloud Run service: ${service}`);
console.log(`Region: ${region}`);
console.log(`Atlas health: ${siteUrl}/api/health/media-worker`);
