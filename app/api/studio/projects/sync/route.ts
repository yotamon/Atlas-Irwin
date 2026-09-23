import { NextResponse } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  ProjectSyncRequestError,
  bootstrapProjectReplica,
  getProjectSyncState,
  syncProjectEnvelope,
  type ProjectSyncScope,
} from "@/lib/project-sync/server";
import { resolveArtistContext } from "@/lib/studio/artist-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function scopeForArtist(artistId: string): Promise<ProjectSyncScope> {
  if (!artistId.trim()) throw new ProjectSyncRequestError("artistId is required.");
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId.trim());
  return {
    workspaceId: artist.workspaceId,
    artistId: artist.artistId,
    actorId: user.id,
  };
}

function failure(error: unknown) {
  if (error instanceof ProjectSyncRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Project sync request failed", error);
  return NextResponse.json({ error: "Could not synchronize the project." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const artistId = url.searchParams.get("artistId")?.trim() ?? "";
    const projectId = url.searchParams.get("projectId")?.trim() ?? "";
    const sinceRaw = url.searchParams.get("sinceRevision");
    const sinceRevision = sinceRaw == null || sinceRaw === "" ? undefined : Number(sinceRaw);
    const scope = await scopeForArtist(artistId);
    const result = await getProjectSyncState(scope, projectId, sinceRevision);
    return NextResponse.json(result, { status: result.status === "not_found" ? 404 : 200 });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = record(await request.json().catch(() => null));
    const artistId = typeof body.artistId === "string" ? body.artistId : "";
    const scope = await scopeForArtist(artistId);
    const result = await bootstrapProjectReplica(scope, body.manifest);
    return NextResponse.json(result, { status: result.status === "bootstrap_conflict" ? 409 : 200 });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = record(await request.json().catch(() => null));
    const artistId = typeof body.artistId === "string" ? body.artistId : "";
    const scope = await scopeForArtist(artistId);
    const result = await syncProjectEnvelope(scope, body.envelope);
    const status = result.status === "not_found"
      ? 404
      : result.status === "synced"
        ? 200
        : 409;
    return NextResponse.json(result, { status });
  } catch (error) {
    return failure(error);
  }
}
