export function formatDurationSeconds(totalSeconds: number | null | undefined) {
  if (!totalSeconds || totalSeconds <= 0) return undefined;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatTotalDurationLabel(
  durations: Array<number | null | undefined>,
) {
  if (!durations.length) return undefined;
  const valid = durations.filter((value): value is number => Boolean(value && value > 0));
  if (valid.length !== durations.length) return undefined;
  const totalMinutes = Math.round(valid.reduce((sum, value) => sum + value, 0) / 60);
  return totalMinutes > 0 ? `${totalMinutes} Min` : undefined;
}

export function formatReleaseDateLabel(value?: string | null) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function trackNumber(index: number, explicit?: number | null) {
  if (explicit && explicit > 0) return String(explicit).padStart(2, "0");
  return String(index + 1).padStart(2, "0");
}

export function parseSoundCloudTrackId(url: string) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("soundcloud.com")) return null;
    return url;
  } catch {
    return null;
  }
}

export function extractSoundCloudIdFromRaw(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const id = (raw as { id?: number }).id;
  return typeof id === "number" ? String(id) : null;
}
