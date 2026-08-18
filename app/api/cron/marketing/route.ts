import { runMarketingAutomationCycle } from "@/lib/marketing/automation";
import { processDuePublicationJobs } from "@/lib/marketing/publications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const publications = await processDuePublicationJobs();
    const automation = await runMarketingAutomationCycle();
    return Response.json({ ok: true, publications, automation });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Marketing automation failed." },
      { status: 500 },
    );
  }
}
