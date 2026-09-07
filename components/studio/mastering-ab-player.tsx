"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function dbToLinear(db: number) {
  return Math.min(1, Math.max(0, 10 ** (db / 20)));
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function MasteringABPlayer({
  originalUrl,
  masteredUrl,
  originalLufs,
  masteredLufs,
}: {
  originalUrl: string;
  masteredUrl: string;
  originalLufs: number | null;
  masteredLufs: number | null;
}) {
  const originalRef = useRef<HTMLAudioElement | null>(null);
  const masteredRef = useRef<HTMLAudioElement | null>(null);
  const [active, setActive] = useState<"original" | "mastered">("mastered");
  const [playing, setPlaying] = useState(false);
  const [loudnessMatch, setLoudnessMatch] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");

  const matchedGains = useMemo(() => {
    if (originalLufs === null || masteredLufs === null) return { original: 1, mastered: 1, available: false };
    const target = Math.min(originalLufs, masteredLufs);
    return {
      original: dbToLinear(target - originalLufs),
      mastered: dbToLinear(target - masteredLufs),
      available: true,
    };
  }, [masteredLufs, originalLufs]);

  useEffect(() => {
    const original = originalRef.current;
    const mastered = masteredRef.current;
    if (!original || !mastered) return;
    const originalVolume = loudnessMatch && matchedGains.available ? matchedGains.original : 1;
    const masteredVolume = loudnessMatch && matchedGains.available ? matchedGains.mastered : 1;
    original.volume = active === "original" ? originalVolume : 0;
    mastered.volume = active === "mastered" ? masteredVolume : 0;
  }, [active, loudnessMatch, matchedGains]);

  useEffect(() => {
    const original = originalRef.current;
    const mastered = masteredRef.current;
    if (!original || !mastered) return;
    const originalAudio = original;
    const masteredAudio = mastered;

    function syncTime() {
      setCurrentTime(originalAudio.currentTime);
      if (Math.abs(masteredAudio.currentTime - originalAudio.currentTime) > 0.08 && !masteredAudio.seeking) {
        masteredAudio.currentTime = originalAudio.currentTime;
      }
    }
    function readDuration() {
      const next = Number.isFinite(originalAudio.duration) ? originalAudio.duration : masteredAudio.duration;
      if (Number.isFinite(next) && next > 0) setDuration(next);
    }
    function ended() {
      setPlaying(false);
      setCurrentTime(0);
      originalAudio.currentTime = 0;
      masteredAudio.currentTime = 0;
    }

    originalAudio.addEventListener("timeupdate", syncTime);
    originalAudio.addEventListener("loadedmetadata", readDuration);
    masteredAudio.addEventListener("loadedmetadata", readDuration);
    originalAudio.addEventListener("ended", ended);
    return () => {
      originalAudio.removeEventListener("timeupdate", syncTime);
      originalAudio.removeEventListener("loadedmetadata", readDuration);
      masteredAudio.removeEventListener("loadedmetadata", readDuration);
      originalAudio.removeEventListener("ended", ended);
    };
  }, []);

  async function togglePlayback() {
    const original = originalRef.current;
    const mastered = masteredRef.current;
    if (!original || !mastered) return;
    setError("");
    if (playing) {
      original.pause();
      mastered.pause();
      setPlaying(false);
      return;
    }

    const anchor = Math.max(original.currentTime, mastered.currentTime);
    original.currentTime = anchor;
    mastered.currentTime = anchor;
    const results = await Promise.allSettled([original.play(), mastered.play()]);
    if (results.some((result) => result.status === "rejected")) {
      original.pause();
      mastered.pause();
      setPlaying(false);
      setError("The synchronized comparison could not start. Try again or use the download for external comparison.");
      return;
    }
    setPlaying(true);
  }

  function seek(next: number) {
    const original = originalRef.current;
    const mastered = masteredRef.current;
    if (!original || !mastered) return;
    const value = Math.max(0, Math.min(duration || next, next));
    original.currentTime = value;
    mastered.currentTime = value;
    setCurrentTime(value);
  }

  const originalAttenuation = matchedGains.available ? 20 * Math.log10(Math.max(matchedGains.original, 0.0001)) : 0;
  const masteredAttenuation = matchedGains.available ? 20 * Math.log10(Math.max(matchedGains.mastered, 0.0001)) : 0;

  return (
    <div className="mastering-ab-player">
      <div className="mastering-ab-toolbar">
        <button className="button" type="button" onClick={togglePlayback}>{playing ? "Pause comparison" : "Play comparison"}</button>
        <div className="mastering-ab-toggle" role="group" aria-label="A/B source">
          <button type="button" aria-pressed={active === "original"} onClick={() => setActive("original")}>A · Original</button>
          <button type="button" aria-pressed={active === "mastered"} onClick={() => setActive("mastered")}>B · Mastered</button>
        </div>
        <label className="mastering-loudness-match">
          <input
            type="checkbox"
            checked={loudnessMatch}
            disabled={!matchedGains.available}
            onChange={(event) => setLoudnessMatch(event.target.checked)}
          />
          <span>Loudness-match A/B</span>
        </label>
      </div>

      <div className="mastering-ab-timeline">
        <span>{formatTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.05}
          value={Math.min(currentTime, Math.max(duration, 0.01))}
          aria-label="A/B playback position"
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span>{formatTime(duration)}</span>
      </div>

      <div className="mastering-ab-evidence">
        <span><strong>Listening now</strong>{active === "original" ? "Original" : "Mastered"}</span>
        <span><strong>Loudness match</strong>{matchedGains.available ? loudnessMatch ? "On" : "Off" : "Unavailable"}</span>
        {matchedGains.available && loudnessMatch ? <span><strong>Playback trim</strong>A {originalAttenuation.toFixed(1)} dB · B {masteredAttenuation.toFixed(1)} dB</span> : null}
      </div>

      {error ? <p className="mastering-ab-error" role="alert">{error}</p> : null}
      <audio ref={originalRef} preload="metadata" src={originalUrl} />
      <audio ref={masteredRef} preload="metadata" src={masteredUrl} />
    </div>
  );
}
