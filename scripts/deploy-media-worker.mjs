import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repository = process.env.MEDIA_WORKER_REPOSITORY?.trim() || "atlas-media-worker";
const tag = process.env.MEDIA_WORKER_TAG?.trim() || "latest";
const image = `${repository}:${tag}`;
const vercelProject = process.env.VERCEL_PROJECT?.trim() || "atlas-irwin";
const vercelScope = process.env.VERCEL_SCOPE?.trim() || "cart-shift";
const siteUrl = (process.env.ATLAS_SITE_URL?.trim() || "https://atlasirwin.com").replace(/\/$/, "");

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

function loadEnvFile(path) {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/g, "\n");
  }
}

if (!commandExists("vercel")) {
  throw new Error("Vercel CLI is required. Install it with `npm i -g vercel` and run `vercel login` first.");
}
if (!commandExists("docker", ["version"])) {
  throw new Error("Docker is required to build the Atlas Media Worker image for Vercel Container Registry.");
}

console.log(`Linking this checkout to ${vercelScope}/${vercelProject}...`);
run("vercel", ["link", "--yes", "--project", vercelProject, "--scope", vercelScope]);

console.log(`Building ${image} and pushing it to Vercel Container Registry...`);
run("vercel", ["vcr", "build", "docker", "services/media-worker", image, "--push"]);

// Local Sandbox SDK calls need the short-lived project OIDC token. Production calls are
// automatically authenticated by Vercel, so this file is only used for the deployment smoke test.
const envPath = join(tmpdir(), `atlas-vercel-${process.pid}.env`);
try {
  run("vercel", ["env", "pull", envPath, "--yes", "--environment", "production", "--scope", vercelScope]);
  loadEnvFile(envPath);

  const { Sandbox } = await import("@vercel/sandbox");
  console.log("Smoke-testing the custom image inside a free Vercel Sandbox...");
  const sandbox = await Sandbox.create({
    name: `atlas-worker-smoke-${Date.now()}`,
    image,
    resources: { vcpus: 1 },
    timeout: 5 * 60 * 1000,
    persistent: false,
    tags: { app: "atlas-irwin", job: "deploy-smoke-test" },
  });
  try {
    const result = await sandbox.runCommand({
      cmd: "python",
      args: [
        "-c",
        "from app.main import allin1_infer; import shutil; assert allin1_infer is not None; assert shutil.which('ffmpeg'); print('atlas-media-worker-ok')",
      ],
      cwd: "/app",
    });
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      throw new Error(`Media Worker image smoke test failed: ${stderr}`);
    }
  } finally {
    try {
      await sandbox.stop();
      await sandbox.delete();
    } catch {
      // The short smoke-test Sandbox may already have stopped.
    }
  }
} finally {
  rmSync(envPath, { force: true });
}

console.log("Deploying Atlas with the Vercel-native worker dispatcher...");
run("vercel", ["--prod", "--yes", "--scope", vercelScope]);

console.log("Verifying the public Atlas Media Worker health contract...");
let atlasHealth = null;
for (let attempt = 1; attempt <= 36; attempt += 1) {
  try {
    const response = await fetch(`${siteUrl}/api/health/media-worker`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    atlasHealth = await response.json().catch(() => null);
    if (
      response.ok
      && atlasHealth?.configured === true
      && atlasHealth?.dispatch_mode === "vercel_sandbox"
      && atlasHealth?.zero_cost_mode === true
      && atlasHealth?.music_intelligence_v2 === true
    ) break;
  } catch {
    // Production may still be switching aliases. Retry below.
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}

if (
  atlasHealth?.configured !== true
  || atlasHealth?.dispatch_mode !== "vercel_sandbox"
  || atlasHealth?.zero_cost_mode !== true
  || atlasHealth?.music_intelligence_v2 !== true
) {
  throw new Error(`Atlas did not become healthy after deployment: ${JSON.stringify(atlasHealth)}`);
}

console.log("\nAtlas Media Worker is Vercel-native and ready.");
console.log(`VCR image: ${image}`);
console.log("Runtime: Vercel Sandbox, ephemeral, 4 vCPU / 8 GB for real jobs");
console.log("Concurrency guard: 1 active Media Worker job per owner");
console.log("Paid fallback: disabled");
console.log(`Atlas health: ${siteUrl}/api/health/media-worker`);
