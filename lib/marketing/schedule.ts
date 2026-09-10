export function relativeDate(anchorDate: string, relativeDay: number) {
  const [year, month, day] = anchorDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + relativeDay);
  return date.toISOString().slice(0, 10);
}

function zoneOffsetMs(utcGuess: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(utcGuess);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return representedAsUtc - utcGuess.getTime();
}

export function zonedDateTimeToUtc(date: string, localTime = "18:00", timeZone = "Europe/Berlin") {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  const naive = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const first = new Date(naive.getTime() - zoneOffsetMs(naive, timeZone));
  const corrected = new Date(naive.getTime() - zoneOffsetMs(first, timeZone));
  return corrected.toISOString();
}

export function releaseRelativeTimestamp(
  anchorDate: string | null | undefined,
  relativeDay: number,
  localTime = "18:00",
  timeZone = "Europe/Berlin",
) {
  if (!anchorDate) return null;
  return zonedDateTimeToUtc(relativeDate(anchorDate, relativeDay), localTime, timeZone);
}
