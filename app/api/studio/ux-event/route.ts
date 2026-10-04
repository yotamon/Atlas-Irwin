import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext } from "@/lib/studio/artist-context";

const eventSchema = z.object({
  artistId: z.uuid(),
  sessionId: z.uuid(),
  event: z.enum([
    "surface_view",
    "launcher_opened",
    "launcher_resolution",
    "launcher_action",
    "primary_action",
    "advanced_opened",
    "recommendation_bypass",
    "navigation_recovery",
    "workflow_stage",
    "advanced_detail_dependency",
  ]),
  surface: z.string().trim().min(1).max(40),
  source: z.string().trim().max(120).nullable().optional(),
  previousSurface: z.string().trim().max(40).nullable().optional(),
  intentKind: z.string().trim().max(60).nullable().optional(),
  resultType: z.string().trim().max(40).nullable().optional(),
  resolutionSource: z.string().trim().max(40).nullable().optional(),
  durationMs: z.number().int().min(0).max(86_400_000).nullable().optional(),
  frictionKind: z.enum(["alternate_action", "before_primary_action", "launcher_recovery"]).nullable().optional(),
  workflowStage: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/).nullable().optional(),
  hasQueryState: z.boolean().optional(),
});

function anonymousKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export async function POST(request: Request) {
  const payload = eventSchema.parse(await request.json());
  const { supabase, user } = await requireStudioAdmin();
  await resolveArtistContext(supabase, user, payload.artistId);

  console.info("[ensemblis-ux]", JSON.stringify({
    version: "ux-v5",
    event: payload.event,
    artistKey: anonymousKey(payload.artistId),
    sessionKey: anonymousKey(payload.sessionId),
    surface: payload.surface,
    source: payload.source ?? null,
    previousSurface: payload.previousSurface ?? null,
    intentKind: payload.intentKind ?? null,
    resultType: payload.resultType ?? null,
    resolutionSource: payload.resolutionSource ?? null,
    durationMs: payload.durationMs ?? null,
    frictionKind: payload.frictionKind ?? null,
    workflowStage: payload.workflowStage ?? null,
    hasQueryState: payload.hasQueryState ?? false,
    occurredAt: new Date().toISOString(),
  }));

  return NextResponse.json({ ok: true });
}
