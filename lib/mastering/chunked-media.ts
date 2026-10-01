export type MasteringChunk = {
  index: number;
  storage_path: string;
  offset: number;
  size: number;
  sha256?: string;
};

export type MasteringByteRange = {
  start: number;
  end: number;
  partial: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function masteringChunkManifest(
  value: unknown,
  expectedTotal?: number | null,
): MasteringChunk[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 32) return null;

  const chunks = value.flatMap((entry) => {
    const item = record(entry);
    const index = integer(item.index);
    const offset = integer(item.offset);
    const size = integer(item.size);
    const storagePath = typeof item.storage_path === "string" ? item.storage_path.trim() : "";
    if (
      index === null
      || index < 0
      || offset === null
      || offset < 0
      || size === null
      || size <= 0
      || !storagePath
      || storagePath.includes("..")
      || !/\/chunks\/part-\d{3}\.bin$/.test(storagePath)
    ) return [];
    return [{
      index,
      storage_path: storagePath,
      offset,
      size,
      sha256: typeof item.sha256 === "string" && /^[0-9a-f]{64}$/i.test(item.sha256)
        ? item.sha256.toLowerCase()
        : undefined,
    }];
  }).sort((left, right) => left.index - right.index);

  if (chunks.length !== value.length) return null;
  if (new Set(chunks.map((chunk) => chunk.storage_path)).size !== chunks.length) return null;

  let nextOffset = 0;
  for (let position = 0; position < chunks.length; position += 1) {
    const chunk = chunks[position];
    if (chunk.index !== position || chunk.offset !== nextOffset) return null;
    nextOffset += chunk.size;
  }

  if (
    typeof expectedTotal === "number"
    && Number.isFinite(expectedTotal)
    && expectedTotal > 0
    && nextOffset !== Math.trunc(expectedTotal)
  ) return null;

  return chunks;
}

export function parseMasteringRange(
  value: string | null,
  total: number,
): MasteringByteRange | null {
  if (!Number.isInteger(total) || total <= 0) return null;
  if (!value) return { start: 0, end: total - 1, partial: false };

  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return {
      start: Math.max(0, total - suffix),
      end: total - 1,
      partial: true,
    };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : total - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
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

export function masteringRangeHeaders(input: {
  total: number;
  start: number;
  end: number;
  partial: boolean;
  etag?: string | null;
}) {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": "audio/flac",
    "Content-Length": String(input.end - input.start + 1),
    "X-Content-Type-Options": "nosniff",
  });
  if (input.partial) {
    headers.set("Content-Range", `bytes ${input.start}-${input.end}/${input.total}`);
  }
  if (input.etag) headers.set("ETag", `"${input.etag}"`);
  return headers;
}
