import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  ATLAS_VIBE_IDS,
  MUSIC_PROVIDER_IDS,
  buildAtlasMusicPrompt,
  type AtlasMusicInput,
} from "@/lib/music/atlas-generator";
import {
  generateEleven,
  generateMiniMax,
  providerErrorResponse,
} from "@/lib/music/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const inputSchema = z.object({
  provider: z.enum(MUSIC_PROVIDER_IDS),
  title: z.string().trim().min(1).max(120),
  idea: z.string().trim().min(3).max(1200),
  vibe: z.enum(ATLAS_VIBE_IDS),
  bpm: z.coerce.number().int().min(80).max(150),
  durationSeconds: z.coerce.number().int().min(60).max(300),
  instrumental: z.boolean(),
  lyrics: z.string().max(3500).optional().default(""),
  signatureIdea: z.string().max(500).optional().default(""),
  useAtlasDna: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (!value.instrumental && !value.lyrics.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["lyrics"],
      message: "Lyrics are required for vocal generation.",
    });
  }
});

export async function POST(request: Request) {
  await requireStudioAdmin();

  try {
    const input = inputSchema.parse(await request.json()) as AtlasMusicInput;
    const prompt = buildAtlasMusicPrompt(input);
    const result = input.provider === "minimax"
      ? await generateMiniMax(input, prompt)
      : await generateEleven(input, prompt);

    return new Response(result.body, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        ...(result.contentLength ? { "Content-Length": result.contentLength } : {}),
        "Cache-Control": "no-store",
        "X-Atlas-Provider": result.provider,
        "X-Atlas-Model": result.model,
        "X-Atlas-Estimated-Cost": result.estimatedCostUsd.toFixed(4),
        ...(result.providerRequestId ? { "X-Atlas-Request-Id": result.providerRequestId } : {}),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: error.issues[0]?.message || "Invalid generation request." }, { status: 400 });
    }
    const providerError = providerErrorResponse(error);
    return Response.json({ error: providerError.message }, { status: providerError.status });
  }
}
