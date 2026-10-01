import { NextResponse } from "next/server";
import { asMasteringClient } from "@/lib/mastering/jobs";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Chunk = {
  index: number;
  storage_path: string;
  offset: number;
  size: number;
  sha256?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function chunkManifest(value: unknown): Chunk[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    if (
      typeof item.index !== "number"
      || typeof item.storage_path !== "string"
      || typeof item.offset !== "number"
      || typeof item.size !== "number"
      || item.size <= 0
    ) return [];
    return [{
      index: item.index,
      storage_path: item.storage_path,
      offset: item.offset,
      size: item.size,
      sha256: typeof item.sha256 === "string" ? item.sha256 : undefined,
    }];
  }).sort((left, right) => left.index - right.index);
}

function parseRange(value: string | null, total: number) {
  if (!value) return { start: 0, end: Math.max(0, total - 1), partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  if (!match[1] && !match[2]) return null;

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return {
      start: Math.max(0, total - suffix),
      end: Math.max(0, total - 1),
      partial: true,
    };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : total - 1;
  if (
    !Number.isFinite(start)
    || !Number.isFinite(requestedEnd)
    || start < 0
    || start >= total
    || requestedEnd < start
  ) return null;
  return {
    start,
    end: Math.min(total - 1, requestedEnd),
    partial: true,
  };
}

function responseHeaders(input: {
  total: number;
  start: number;
  end: number;
  partial: boolean;
  etag: string | null;
}) {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": "audio/flac",
    "Content-Length": String(input.end - input.start + 1),
    "X-Content-Type-Options": "nosniff",
  });
  if (input.partial) headers.set("Content-Range", `bytes ${input.start}-${input.end}/${input.total}`);
  if (input.etag) headers.set("ETag", `"${input.etag}"`);
  return headers;
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

  const chunks = chunkManifest(metadata.chunk_manifest);
  const total = typeof metadata.canonical_file_size === "number"
    ? metadata.canonical_file_size
    : chunks.reduce((sum, chunk) => sum + chunk.size, 0);
  if (!chunks.length || total <= 0) {
    return new NextResponse("Mastering chunk manifest is incomplete.", { status: 500 });
  }
  const range = parseRange(request.headers.get("range"), total);
  if (!range) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${total}`,
      },
    });
  }

  const headers = responseHeaders({
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
