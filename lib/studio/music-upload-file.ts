/**
 * Some browsers report downloaded WAV/FLAC/AIFF files with an empty MIME type,
 * which would fail client-side validation before the server can inspect audio.
 * Only promote recognized audio extensions for untyped/octet-stream files.
 * Never reinterpret a file already identified as a non-audio content type.
 */
export function normalizeAudioMime(file: File): File {
  if (file.type.startsWith("audio/")) return file;
  if (file.type && file.type !== "application/octet-stream") return file;
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const types: Record<string, string> = {
    wav: "audio/wav", wave: "audio/wav", flac: "audio/flac",
    aif: "audio/aiff", aiff: "audio/aiff", mp3: "audio/mpeg",
    m4a: "audio/mp4",
  };
  const mime = types[extension];
  return mime ? new File([file], file.name, { type: mime, lastModified: file.lastModified }) : file;
}
