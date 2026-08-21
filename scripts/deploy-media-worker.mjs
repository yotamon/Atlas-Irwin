import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const service = process.env.MEDIA_WORKER_SERVICE?.trim() || "atlas-media-worker";
const queue = process.env.MEDIA_WORKER_QUEUE?.trim() || "atlas-media-worker";
const region = process.env.GCP_REGION?.trim() || "europe-west3";
const secretName = process.env.MEDIA_WORKER_SECRET_NAME?.trim() || "atlas-media-worker-secret";
const serviceAccountName = process.env.MEDIA_WORKER_SERVICE_ACCOUNT?.trim() || "atlas-media-worker";
const maxConcurrent = process.env.MEDIA_WORKER_MAX_CONCURRENT?.trim() || "1";
const vercelProject = process.env.VERCEL_PROJECT?.trim() || "atlas-irwin";
const vercelScope = process.env.VERCEL_SCOPE?.trim() || "cart-shift";
const siteUrl = (process.env.ATLAS_SITE_URL?.trim() || "https://atlasirwin.com").replace(/\/$/, "");
const syncPreview = process.env.MEDIA_WORKER_SYNC_PREVIEW !== "false";

function run(command, args, options = {}) {
  const capture = options.capture === true;
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: capture
      ? [options.input !== undefined ? "pipe" : "ignore", "pipe", options.quiet ? "ignore" : "inherit"]
      : [options.input !== undefined ? "pipe" : "inherit", "inherit", "inherit"],
    input: options.input,
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.error && !options.allowFailure) throw result.error;
  if (result.status !== 0) {
    if (options.allowFailure) return null;
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
  return capture ? result.stdout.trim() : "";
}

function commandExists(command, versionArgs = ["--version"]) {
  return run(command, versionArgs, { capture: true, quiet: true, allowFailure: true }) !== null;
}

if (!commandExists("gcloud")) {
  throw new Error("Google Cloud CLI (gcloud) is required. Install it and run `gcloud auth login` first.");
}
if (!commandExists("vercel")) {
  throw new Error("Vercel CLI is required. Install it with `npm i -g vercel` and run `vercel login` first.");
}

const configuredProject = run("gcloud", ["config", "get-value", "project"], { capture: true, quiet: true });
const project = process.env.GCP_PROJECT_ID?.trim() || (configuredProject && configuredProject !== "(unset)" ? configuredProject : "");
if (!project) {
  throw new Error("No GCP project is configured. Set GCP_PROJECT_ID or run `gcloud config set project <PROJECT_ID>`.");
}

console.log(`Preparing Google Cloud project ${project}...`);
run("gcloud", [
  "services", "enable",
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "cloudtasks.googleapis.com",
  "secretmanager.googleapis.com",
  "iam.googleapis.com",
  "--project", project,
  "--quiet",
]);

const serviceAccountEmail = `${serviceAccountName}@${project}.iam.gserviceaccount.com`;
const existingServiceAccount = run("gcloud", [
  "iam", "service-accounts", "describe", serviceAccountEmail,
  "--project", project,
], { capture: true, quiet: true, allowFailure: true });
if (existingServiceAccount === null) {
  console.log(`Creating dedicated service account ${serviceAccountEmail}...`);
  run("gcloud", [
    "iam", "service-accounts", "create", serviceAccountName,
    "--project", project,
    "--display-name", "Atlas Media Worker",
    "--quiet",
  ]);
}

let secret = process.env.MEDIA_WORKER_SECRET?.trim() || "";
const existingSecret = run("gcloud", [
  "secrets", "describe", secretName,
  "--project", project,
], { capture: true, quiet: true, allowFailure: true });

if (!secret && existingSecret !== null) {
  secret = run("gcloud", [
    "secrets", "versions", "access", "latest",
    "--secret", secretName,
    "--project", project,
  ], { capture: true, quiet: true }) || "";
}
if (!secret) secret = randomBytes(32).toString("base64url");

if (existingSecret === null) {
  console.log("Creating the shared worker secret in Secret Manager...");
  run("gcloud", [
    "secrets", "create", secretName,
    "--project", project,
    "--replication-policy", "automatic",
    "--data-file=-",
    "--quiet",
  ], { input: `${secret}\n` });
} else if (process.env.MEDIA_WORKER_SECRET?.trim()) {
  console.log("Rotating the Secret Manager value to the explicitly supplied MEDIA_WORKER_SECRET...");
  run("gcloud", [
    "secrets", "versions", "add", secretName,
    "--project", project,
    "--data-file=-",
    "--quiet",
  ], { input: `${secret}\n` });
}

run("gcloud", [
  "secrets", "add-iam-policy-binding", secretName,
  "--project", project,
  "--member", `serviceAccount:${serviceAccountEmail}`,
  "--role", "roles/secretmanager.secretAccessor",
  "--quiet",
]);
run("gcloud", [
  "projects", "add-iam-policy-binding", project,
  "--member", `serviceAccount:${serviceAccountEmail}`,
  "--role", "roles/cloudtasks.enqueuer",
  "--quiet",
]);

const existingQueue = run("gcloud", [
  "tasks", "queues", "describe", queue,
  "--location", region,
  "--project", project,
], { capture: true, quiet: true, allowFailure: true });
if (existingQueue === null) {
  console.log(`Creating Cloud Tasks queue ${queue}...`);
  run("gcloud", [
    "tasks", "queues", "create", queue,
    "--location", region,
    "--project", project,
    "--max-concurrent-dispatches", maxConcurrent,
    "--max-dispatches-per-second", maxConcurrent,
    "--quiet",
  ]);
} else {
  run("gcloud", [
    "tasks", "queues", "update", queue,
    "--location", region,
    "--project", project,
    "--max-concurrent-dispatches", maxConcurrent,
    "--max-dispatches-per-second", maxConcurrent,
    "--quiet",
  ]);
}

console.log(`Deploying ${service} to Cloud Run (${region}, scale-to-zero)...`);
run("gcloud", [
  "run", "deploy", service,
  "--project", project,
  "--source", "services/media-worker",
  "--region", region,
  "--platform", "managed",
  "--allow-unauthenticated",
  "--service-account", serviceAccountEmail,
  "--set-env-vars", `GCP_PROJECT_ID=${project},CLOUD_TASKS_LOCATION=${region},CLOUD_TASKS_QUEUE=${queue}`,
  "--set-secrets", `MEDIA_WORKER_SECRET=${secretName}:latest`,
  "--min-instances", "0",
  "--max-instances", maxConcurrent,
  "--concurrency", "1",
  "--cpu", "4",
  "--memory", "8Gi",
  "--timeout", "1800",
  "--cpu-boost",
  "--quiet",
]);

const workerUrl = run("gcloud", [
  "run", "services", "describe", service,
  "--project", project,
  "--region", region,
  "--platform", "managed",
  "--format=value(status.url)",
], { capture: true, quiet: true });
if (!workerUrl?.startsWith("https://")) throw new Error("Cloud Run deployed, but no HTTPS service URL was returned.");

console.log("Verifying worker v2.1, Cloud Tasks dispatch, and semantic analysis support...");
const workerHealth = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(60_000) });
const workerPayload = await workerHealth.json().catch(() => ({}));
if (!workerHealth.ok || Number(workerPayload?.version) < 2.1) {
  throw new Error(`Cloud Run health check failed or returned an old worker version: ${JSON.stringify(workerPayload)}`);
}
if (workerPayload?.dispatch_mode !== "cloud_tasks") {
  throw new Error(`Worker is not using durable Cloud Tasks dispatch: ${JSON.stringify(workerPayload)}`);
}
if (workerPayload?.music_intelligence?.semantic_analyzer_available !== true) {
  throw new Error(`Worker is running, but all-in-one-infer is unavailable: ${JSON.stringify(workerPayload)}`);
}

console.log(`Linking Vercel CLI to ${vercelScope}/${vercelProject}...`);
run("vercel", ["link", "--yes", "--project", vercelProject, "--scope", vercelScope]);

function setVercelEnv(name, value, environment) {
  run("vercel", ["env", "rm", name, environment, "--yes", "--scope", vercelScope], {
    allowFailure: true,
  });
  run("vercel", ["env", "add", name, environment, "--scope", vercelScope], {
    input: `${value}\n`,
  });
}

console.log("Connecting production Vercel to the worker...");
setVercelEnv("MEDIA_WORKER_URL", workerUrl, "production");
setVercelEnv("MEDIA_WORKER_SECRET", secret, "production");
if (syncPreview) {
  setVercelEnv("MEDIA_WORKER_URL", workerUrl, "preview");
  setVercelEnv("MEDIA_WORKER_SECRET", secret, "preview");
}

console.log("Redeploying Atlas so the new environment values take effect...");
run("vercel", ["--prod", "--yes", "--scope", vercelScope]);

console.log("Verifying Atlas -> Cloud Run connectivity...");
let atlasHealth = null;
for (let attempt = 1; attempt <= 36; attempt += 1) {
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
console.log(`Cloud Tasks queue: ${queue}`);
console.log(`Region: ${region}`);
console.log("Cloud Run idle instances: 0 (scale-to-zero enabled)");
console.log(`Atlas health: ${siteUrl}/api/health/media-worker`);
