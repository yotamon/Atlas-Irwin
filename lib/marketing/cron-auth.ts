import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { createAutonomyServiceClient } from "./autonomy-db";

const MARKETING_CRON_SECRET_KEY = "marketing_cron";

function secureEqualText(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function authorizeMarketingCron(request: Request) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return { authorized: false as const, configured: true as const };
  }
  const supplied = header.slice("Bearer ".length).trim();
  if (!supplied) return { authorized: false as const, configured: true as const };

  // Keep compatibility with Vercel's native CRON_SECRET if it is ever configured,
  // but Atlas does not require a Vercel secret for the five-minute Supabase scheduler.
  const envSecret = process.env.CRON_SECRET?.trim();
  if (envSecret && secureEqualText(supplied, envSecret)) {
    return { authorized: true as const, configured: true as const, source: "vercel_env" as const };
  }

  const client = createAutonomyServiceClient();
  const { data, error } = await client
    .from("automation_runtime_secrets")
    .select("secret_hash")
    .eq("key", MARKETING_CRON_SECRET_KEY)
    .maybeSingle();

  if (error) {
    console.error("[marketing-cron] Could not read runtime credential hash", error);
    return { authorized: false as const, configured: false as const };
  }
  if (!data?.secret_hash) {
    return { authorized: false as const, configured: false as const };
  }

  return {
    authorized: secureEqualText(sha256(supplied), data.secret_hash),
    configured: true as const,
    source: "supabase_vault" as const,
  };
}
