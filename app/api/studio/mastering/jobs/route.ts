import { NextResponse } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMasteringClient } from "@/lib/mastering/jobs";
import { resolveArtistContext } from "@/lib/studio/artist-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const artistId = url.searchParams.get("artist")?.trim() || "";
  const trackId = url.searchParams.get("track")?.trim() || "";
  if (!UUID_RE.test(artistId) || !UUID_RE.test(trackId)) {
    return NextResponse.json({ error: "A valid artist and track are required." }, { status: 400 });
  }

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  const db = asMasteringClient(supabase);
  const jobs = await db.from("track_mastering_jobs")
    .select("*")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("track_vault_id", trackId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (jobs.error) {
    return NextResponse.json({ error: "Could not load mastering runs." }, { status: 500 });
  }

  return NextResponse.json({
    jobs: (jobs.data ?? []).map((job) => {
      const requestPayload = record(job.request_payload);
      return {
        id: job.id,
        preset: job.preset,
        status: job.status,
        error: job.error ? "The mastering worker could not complete this render." : null,
        createdAt: job.created_at,
        outputUrl: job.status === "completed" && typeof requestPayload.public_url === "string" ? requestPayload.public_url : null,
        result: job.result_payload,
      };
    }),
  });
}
