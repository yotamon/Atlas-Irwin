import { NextResponse } from "next/server";
import {
  masteringChunkManifest,
  masteringRangeHeaders,
  parseMasteringRange,
} from "@/lib/mastering/chunked-media";
import { asMasteringClient } from "@/lib/mastering/jobs";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function resolveMasteringAsset(jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const service = createServiceClient();
  const mastering = asMasteringClient(service);
  const job = await mastering.from("track_mastering_jobs")
    .select("output_asset_id,status")
    .eq("id", jobId)
    .eq("status", "completed")
    .maybeSingle();
  if (job.error || !job.data?.output_asset_id) return null;

  const asset = await service.from("media_assets")
    .select("id,bucket_name,storage_path,public_url,mime_type,file_size,content_hash,visibility,metadata")
    .eq("id", job.data.output_asset_id)
    .eq("asset_type", "master_audio")
    .maybeSingle();
  if (asset.error || !asset.data || asset.data.visibility !== "public") return null;
  const metadata = record(asset.data.metadata);
  if (metadata.mastering_job_id !== jobId) return null;
  return { service, asset: asset.data, metadata };
}

async function serve(request: Request, jobId: string, headOnly: boolean) {
  const resolved = await resolveMasteringAsset(jobId);
  if (!resolved) return new NextResponse("Mastering asset not found.", { status: 404 });
  const { service, asset, metadata } = resolved;
  const mode = typeof metadata.storage_mode === "string" ? metadata.storage_mode : "single_object";
  if (mode !== "chunked_lossless") {
    if (!asset.public_url) return new NextResponse("Mastering asset URL is unavailable.", { status: 404 });
    return NextResponse.redirect(asset.public_url, 307);
  }

  const canonicalTotal = typeof metadata.canonical_file_size === "number"
    && Number.isInteger(metadata.canonical_file_size)
    && metadata.canonical_file_size > 0
    ? metadata.canonical_file_size
    : null;
  const chunks = masteringChunkManifest(metadata.chunk_manifest, canonicalTotal);
  if (!chunks) {
    return new NextResponse("Mastering chunk manifest is incomplete.", { status: 500 });
  }
  const total = canonicalTotal ?? chunks.reduce((sum, chunk) => sum + chunk.size, 0);
  const range = parseMasteringRange(request.headers.get("range"), total);
  if (!range) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${total}`,
      },
    });
  }

  const headers = masteringRangeHeaders({
    total,
    start: range.start,
    end: range.end,
    partial: range.partial,
    etag: asset.content_hash,
  });
  if (headOnly) {
    return new NextResponse(null, { status: range.partial ? 206 : 200, headers });
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          for (const chunk of chunks) {
            const chunkStart = chunk.offset;
            const chunkEnd = chunk.offset + chunk.size - 1;
            if (chunkEnd < range.start || chunkStart > range.end) continue;

            const localStart = Math.max(0, range.start - chunkStart);
            const localEnd = Math.min(chunk.size - 1, range.end - chunkStart);
            const url = service.storage.from(asset.bucket_name).getPublicUrl(chunk.storage_path).data.publicUrl;
            const response = await fetch(url, {
              headers: {
                Range: `bytes=${localStart}-${localEnd}`,
              },
              cache: "force-cache",
            });
            if (!response.ok || !response.body) {
              throw new Error(`Could not read mastering chunk ${chunk.index}.`);
            }

            const wantsWholeChunk = localStart === 0 && localEnd === chunk.size - 1;
            if (response.status === 200 && !wantsWholeChunk) {
              // Some object/CDN paths may ignore Range. Slice defensively so
              // Ensemblis still honors the canonical FLAC byte range exactly.
              const bytes = new Uint8Array(await response.arrayBuffer());
              controller.enqueue(bytes.slice(localStart, localEnd + 1));
              continue;
            }

            const reader = response.body.getReader();
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value) controller.enqueue(value);
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      })();
    },
  });

  return new NextResponse(body, {
    status: range.partial ? 206 : 200,
    headers,
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  return serve(request, jobId, false);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  return serve(request, jobId, true);
}
