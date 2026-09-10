import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const IGNORED_PREFIXES = [
  ".github/",
  "docs/",
  "e2e/",
  "tests/",
  "apps/library-bridge/",
  "supabase/",
];

export function isDeploymentNeutralPath(path) {
  if (!path) return true;
  if (path === "LICENSE") return true;
  if (/\.md$/i.test(path)) return true;
  return IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function shouldIgnoreDeployment(paths) {
  return paths.every(isDeploymentNeutralPath);
}

export function changedFiles(previousSha, head = "HEAD") {
  if (!previousSha || !/^[a-f0-9]{7,40}$/i.test(previousSha)) {
    throw new Error("VERCEL_GIT_PREVIOUS_SHA is unavailable or invalid");
  }

  return execFileSync("git", ["diff", "--name-only", previousSha, head], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function run() {
  try {
    const paths = changedFiles(process.env.VERCEL_GIT_PREVIOUS_SHA?.trim() || "");
    if (shouldIgnoreDeployment(paths)) {
      console.log("Skipping Vercel build: all changes are deployment-neutral.");
      process.exit(0);
    }

    const runtimePaths = paths.filter((path) => !isDeploymentNeutralPath(path));
    console.log(`Running Vercel build: runtime/build paths changed: ${runtimePaths.join(", ")}`);
    process.exit(1);
  } catch (error) {
    // Vercel interprets exit 0 as "skip build". Any uncertainty must therefore fail open
    // to a real build so a missing SHA or unusual Git state can never hide runtime changes.
    console.warn(`Running Vercel build conservatively: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
