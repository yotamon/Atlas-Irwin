import { spawnSync } from "node:child_process";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim() || "";
const email = (process.env.STUDIO_E2E_EMAIL || process.env.STUDIO_ADMIN_EMAILS?.split(",")[0] || "").trim();
const password = process.env.STUDIO_E2E_PASSWORD || process.env.STUDIO_PASSWORD || "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
const localTarget = !baseUrl || /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(baseUrl);

if (!email || !password) {
  if (!localTarget || !serviceRole) {
    console.error(
      "Authenticated Studio E2E requires STUDIO_E2E_EMAIL/STUDIO_E2E_PASSWORD for a real login, "
      + "or SUPABASE_SERVICE_ROLE_KEY for the existing safe localhost Studio path.",
    );
    process.exit(1);
  }
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  command,
  ["playwright", "test", "e2e/ensemblis-ux-v5.spec.mjs", "--config=playwright.config.mjs"],
  {
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_STUDIO_E2E: "1" },
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
