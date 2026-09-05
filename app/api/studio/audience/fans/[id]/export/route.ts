import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { fanExportPayload, loadFanDetail } from "@/lib/audience/fan-graph-server";
import type { FanGraphDatabase } from "@/types/fan-graph-database";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = request.nextUrl.searchParams.get("artist_id")?.trim() || undefined;
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, requestedArtistId)
    : await resolveDefaultArtistContext(supabase, user);
  const detail = await loadFanDetail(supabase, user.id, artist.artistId, id);
  if (!detail) return NextResponse.json({ error: "Fan relationship not found." }, { status: 404 });

  const db = supabase as unknown as SupabaseClient<FanGraphDatabase>;
  const { error } = await db.rpc("record_fan_export", { p_fan_id: id });
  if (error) throw new Error(error.message);

  return NextResponse.json(fanExportPayload(detail), {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `attachment; filename="ensemblis-fan-${id}.json"`,
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
