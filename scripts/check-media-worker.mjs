const siteUrl = (process.env.ATLAS_SITE_URL?.trim() || "https://atlasirwin.com").replace(/\/$/, "");

console.log("Atlas Media Worker is deployment-native on Vercel Sandbox.");
console.log("There is no separate Cloud Run or worker deployment step.");
console.log(`Health endpoint: ${siteUrl}/api/health/media-worker`);
console.log("The first real analysis lazily initializes the persistent Python Sandbox and caches its dependencies for later jobs.");

if (process.argv.includes("--remote")) {
  const response = await fetch(`${siteUrl}/api/health/media-worker`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  console.log(JSON.stringify(payload, null, 2));
  if (!response.ok || payload?.configured !== true || payload?.dispatch_mode !== "vercel_sandbox") {
    process.exitCode = 1;
  }
}
