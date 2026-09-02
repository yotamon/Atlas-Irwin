import { authorizeMarketingCron } from "@/lib/marketing/cron-auth";
import { fillOneMissingScheduledAsset } from "@/lib/marketing/free-content-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// First-run Vercel Sandbox bootstrap installs the local ffmpeg binary before rendering.
// Hobby/Fluid Compute supports a longer function window; keep this comfortably above
// the Sandbox lifetime while the database-side caller uses a slightly shorter timeout.
export const maxDuration = 240;

export async function GET(request: Request) {
  const auth = await authorizeMarketingCron(request);
  if (!auth.authorized) {
    if (!auth.configured) {
      return Response.json({ error: "Marketing cron authentication is not provisioned." }, { status: 503 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await fillOneMissingScheduledAsset();
    return Response.json({
      ok: true,
      mode: "free-tier-safe-content-factory",
      authSource: auth.source,
      result,
    });
  } catch (error) {
    console.error("[content-factory-cron] composition cycle failed", error);
    return Response.json({
      ok: false,
      mode: "free-tier-safe-content-factory",
      authSource: auth.source,
      error: error instanceof Error ? error.message : "Content factory cycle failed.",
    }, { status: 500 });
  }
}
