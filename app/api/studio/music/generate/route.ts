import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  MUSIC_PROVIDER_IDS,
  MUSIC_VIBE_IDS,
  buildMusicPrompt,
  type MusicGenerationInput,
} from "@/lib/music/generator";
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
  vibe: z.enum(MUSIC_VIBE_IDS),
  bpm: z.coerce.number().int().min(80).max(150),
  durationSeconds: z.coerce.number().int().min(60).max(300),
  instrumental: z.boolean(),
  lyrics: z.string().max(3500).optional().default(""),
  signatureIdea: z.string().max(500).optional().default(""),
  brandContext: z.string().max(2000).optional().default(""),
  preserveArtistDna: z.boolean().optional(),
  // Transitional compatibility for clients deployed before the Ensemblis decoupling.
  useAtlasDna: z.boolean().optional(),
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
    const parsed = inputSchema.parse(await request.json());
    const input: MusicGenerationInput = {
      provider: parsed.provider,
      title: parsed.title,
      idea: parsed.idea,
      vibe: parsed.vibe,
      bpm: parsed.bpm,
      durationSeconds: parsed.durationSeconds,
      instrumental: parsed.instrumental,
      lyrics: parsed.lyrics,
      signatureIdea: parsed.signatureIdea,
      brandContext: parsed.brandContext,
      preserveArtistDna: parsed.preserveArtistDna ?? parsed.useAtlasDna ?? true,
    };
    const prompt = buildMusicPrompt(input);
    const result = input.provider === "minimax"
      ? await generateMiniMax(input, prompt)
      : await generateEleven(input, prompt);
    const cost = result.estimatedCostUsd.toFixed(4);

    return new Response(result.body, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        ...(result.contentLength ? { "Content-Length": result.contentLength } : {}),
        "Cache-Control": "no-store",
        "X-Ensemblis-Music-Provider": result.provider,
        "X-Ensemblis-Music-Model": result.model,
        "X-Ensemblis-Music-Estimated-Cost": cost,
        ...(result.providerRequestId ? { "X-Ensemblis-Music-Request-Id": result.providerRequestId } : {}),
        // Keep one release of response-header compatibility for an already-open Studio tab.
        "X-Atlas-Provider": result.provider,
        "X-Atlas-Model": result.model,
        "X-Atlas-Estimated-Cost": cost,
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
