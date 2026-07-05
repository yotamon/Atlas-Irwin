import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function platformTarget() {
  const parts = [process.platform, process.arch];
  if (process.platform === "win32") {
    parts.push("msvc");
  }
  return parts.join("-");
}

function readPackageVersion(relativePath) {
  const packageJsonPath = join(root, relativePath);
  if (!existsSync(packageJsonPath)) {
    return null;
  }
  return JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
}

function removePath(targetPath) {
  try {
    execSync(`rm -rf ${JSON.stringify(targetPath)}`, { cwd: root, stdio: "ignore" });
    return;
  } catch {
    // Windows fallback
  }

  try {
    execSync(`Remove-Item -Recurse -Force ${JSON.stringify(targetPath)}`, {
      cwd: root,
      stdio: "ignore",
      shell: "powershell.exe",
    });
  } catch {
    // best effort cleanup
  }
}

function fetchNativeFromNpm(packageName, version, fileName) {
  const tarball = execSync(`npm pack ${packageName}@${version}`, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .trim()
    .split("\n")
    .at(-1)
    ?.trim();

  if (!tarball) {
    return null;
  }

  const tarballPath = join(root, tarball);
  const packageDir = join(root, "package");
  const extracted = join(packageDir, fileName);
  const stagingPath = join(root, `.postinstall-${fileName}`);

  try {
    execSync(`tar -xf ${JSON.stringify(tarballPath)}`, { cwd: root, stdio: "ignore" });
    if (!existsSync(extracted)) {
      return null;
    }
    copyFileSync(extracted, stagingPath);
    return stagingPath;
  } finally {
    removePath(packageDir);
    removePath(tarballPath);
  }
}

function resolveNativeSource(packageName, fileName, version) {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const candidate = join(dirname(packageJsonPath), fileName);
    if (existsSync(candidate)) {
      return { path: candidate, staged: false };
    }
  } catch {
    // Optional platform package may be missing when npm and Node CPU targets differ.
  }

  const stagedPath = fetchNativeFromNpm(packageName, version, fileName);
  return stagedPath ? { path: stagedPath, staged: true } : null;
}

function ensureNativeBinding({ packageName, hostDir, fileName, version }) {
  if (!version) {
    return;
  }

  const targetPath = join(root, hostDir, fileName);
  if (existsSync(targetPath)) {
    return;
  }

  const source = resolveNativeSource(packageName, fileName, version);
  if (!source || !existsSync(source.path)) {
    return;
  }

  mkdirSync(join(root, hostDir), { recursive: true });
  copyFileSync(source.path, targetPath);

  if (source.staged) {
    try {
      unlinkSync(source.path);
    } catch {
      // best effort cleanup
    }
  }
}

function ensureNativeBindings() {
  // Linux/macOS CI (including Vercel) install the correct optional native packages.
  if (process.platform !== "win32") {
    return;
  }

  const target = platformTarget();

  ensureNativeBinding({
    packageName: `lightningcss-${target}`,
    hostDir: "node_modules/lightningcss",
    fileName: `lightningcss.${target}.node`,
    version: readPackageVersion("node_modules/lightningcss/package.json"),
  });

  ensureNativeBinding({
    packageName: `@tailwindcss/oxide-${target}`,
    hostDir: "node_modules/@tailwindcss/oxide",
    fileName: `tailwindcss-oxide.${target}.node`,
    version: readPackageVersion("node_modules/@tailwindcss/oxide/package.json"),
  });
}

ensureNativeBindings();
