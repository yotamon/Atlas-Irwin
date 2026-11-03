/**
 * Conservative file-name interpretation for source-first music intake.
 * We only extract an explicitly labeled mastering/version suffix. Creative
 * parentheticals stay part of the title, and no final/approved state is inferred.
 */
export type MusicFilenameIdentity = {
  title: string;
  version: string | null;
};

const AUDIO_EXTENSION = /\.(?:wav|wave|flac|aif|aiff|mp3|m4a)(?:\s*\(\d+\))?$/i;
const KNOWN_VERSION = /\s+\((remastered?(?:\s+x?\d+)?|master(?:ed)?(?:\s+v?\d+)?|final master|final mix|mix\s+v\d+|v\d+)\)$/i;

export function musicFilenameIdentity(filename: string): MusicFilenameIdentity {
  const normalized = filename.trim().replace(AUDIO_EXTENSION, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const version = normalized.match(KNOWN_VERSION);
  const title = (version ? normalized.slice(0, version.index).trim() : normalized)
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: title || "Untitled master",
    version: version?.[1] ?? null,
  };
}
