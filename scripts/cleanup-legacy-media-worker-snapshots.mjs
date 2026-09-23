import { pathToFileURL } from "node:url";

const API_BASE = "https://api.vercel.com";

function argumentValue(name) {
  const prefix = `--${name}=`;
  const candidate = process.argv.find((value) => value.startsWith(prefix));
  return candidate ? candidate.slice(prefix.length) : "";
}

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function legacySandboxNames(environment, throughVersion) {
  return Array.from(
    { length: throughVersion },
    (_, index) => `atlas-media-worker-${environment}-v${index + 1}`,
  );
}

async function vercelRequest(path, token, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Vercel API ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function snapshotList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.snapshots)) return payload.snapshots;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function snapshotsForName({ token, projectId, teamId, name }) {
  const query = new URLSearchParams({
    project: projectId,
    name,
    limit: "100",
    teamId,
  });
  const payload = await vercelRequest(`/v2/sandboxes/snapshots?${query}`, token);
  return snapshotList(payload);
}

async function deleteSnapshot({ token, teamId, snapshotId }) {
  const query = new URLSearchParams({ teamId });
  return vercelRequest(
    `/v2/sandboxes/snapshots/${encodeURIComponent(snapshotId)}?${query}`,
    token,
    { method: "DELETE" },
  );
}

async function run() {
  const apply = process.argv.includes("--apply");
  const token = required("VERCEL_TOKEN", process.env.VERCEL_TOKEN?.trim() || "");
  const projectId = required(
    "VERCEL_PROJECT_ID or --project",
    argumentValue("project") || process.env.VERCEL_PROJECT_ID?.trim() || "",
  );
  const teamId = required(
    "VERCEL_TEAM_ID or --team",
    argumentValue("team") || process.env.VERCEL_TEAM_ID?.trim() || "",
  );
  const environment = argumentValue("environment") || "production";
  const throughVersion = Number.parseInt(argumentValue("through-version") || "12", 10);
  if (!Number.isInteger(throughVersion) || throughVersion < 1 || throughVersion > 99) {
    throw new Error("--through-version must be an integer from 1 to 99");
  }

  console.log(
    `${apply ? "APPLY" : "DRY RUN"}: scanning legacy ${environment} Media Worker snapshot lineages v1..v${throughVersion}`,
  );

  let found = 0;
  let deleted = 0;
  let bytes = 0;
  for (const name of legacySandboxNames(environment, throughVersion)) {
    const snapshots = await snapshotsForName({ token, projectId, teamId, name });
    for (const snapshot of snapshots) {
      const snapshotId = String(snapshot?.id || "");
      if (!snapshotId.startsWith("snap_")) continue;
      found += 1;
      bytes += Number(snapshot?.sizeBytes || 0);
      console.log(`${apply ? "DELETE" : "WOULD DELETE"} ${name} ${snapshotId} ${snapshot?.sizeBytes || "?"} bytes`);
      if (apply) {
        await deleteSnapshot({ token, teamId, snapshotId });
        deleted += 1;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        environment,
        throughVersion,
        snapshotsFound: found,
        snapshotsDeleted: deleted,
        bytesMatched: bytes,
      },
      null,
      2,
    ),
  );

  if (!apply && found > 0) {
    console.log("Re-run with --apply only after the generation-stable Media Worker is verified in production.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
