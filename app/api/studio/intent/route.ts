import { NextResponse } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext } from "@/lib/studio/artist-context";
import { resolveStudioIntent } from "@/lib/studio/intent/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const artistId = url.searchParams.get("artist")?.trim() ?? "";
  const semantic = url.searchParams.get("semantic") === "1";

  if (!artistId || query.length < 2) {
    return NextResponse.json({
      intent: null,
      results: [],
      usedSemanticFallback: false,
    });
  }

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  const resolution = await resolveStudioIntent({
    db: supabase,
    ownerId: user.id,
    artist,
    query,
    allowSemanticFallback: semantic,
  });

  return NextResponse.json(resolution);
}
