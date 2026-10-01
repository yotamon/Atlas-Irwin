"use client";

import { useRef, useState } from "react";
import styles from "@/components/studio/release-mastering-sequence-player.module.css";

export type ReleaseSequenceTrack = {
  id: string;
  title: string;
  url: string;
};

function waitForMetadata(audio: HTMLAudioElement) {
  if (Number.isFinite(audio.duration) && audio.duration > 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("Could not load this master for sequence audition."));
    };
    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", ready);
      audio.removeEventListener("error", failed);
    };
    audio.addEventListener("loadedmetadata", ready, { once: true });
    audio.addEventListener("error", failed, { once: true });
    audio.load();
  });
}

export function ReleaseMasteringSequencePlayer({
  tracks,
}: {
  tracks: ReleaseSequenceTrack[];
}) {
  const previousRef = useRef<HTMLAudioElement>(null);
  const nextRef = useRef<HTMLAudioElement>(null);
  const [pairIndex, setPairIndex] = useState(0);
  const [playing, setPlaying] = useState<"tail" | "intro" | null>(null);
  const [error, setError] = useState("");

  if (tracks.length < 2) return null;
  const index = Math.min(pairIndex, tracks.length - 2);
  const previous = tracks[index];
  const next = tracks[index + 1];

  function stop() {
    for (const audio of [previousRef.current, nextRef.current]) {
      if (!audio) continue;
      audio.pause();
    }
    setPlaying(null);
  }

  async function playSequence() {
    const previousAudio = previousRef.current;
    const nextAudio = nextRef.current;
    if (!previousAudio || !nextAudio) return;
    stop();
    setError("");
    try {
      await Promise.all([waitForMetadata(previousAudio), waitForMetadata(nextAudio)]);
      previousAudio.currentTime = Math.max(0, previousAudio.duration - 8);
      nextAudio.currentTime = 0;
      setPlaying("tail");
      await previousAudio.play();
    } catch (reason) {
      setPlaying(null);
      setError(reason instanceof Error ? reason.message : "Could not play this sequence.");
    }
  }

  async function continueToIntro() {
    const nextAudio = nextRef.current;
    if (!nextAudio || playing !== "tail") return;
    setPlaying("intro");
    nextAudio.currentTime = 0;
    try {
      await nextAudio.play();
    } catch {
      setPlaying(null);
      setError("The next track could not start automatically. Tap Play sequence again.");
    }
  }

  function choosePair(value: number) {
    stop();
    setPairIndex(value);
    setError("");
  }

  return (
    <div className={styles.root}>
      <div className={styles.copy}>
        <span className="section-label">Sequence audition</span>
        <strong>{previous.title} → {next.title}</strong>
        <small>8-second tail into the next master at their real relative levels. No loudness matching is applied here.</small>
      </div>
      <div className={styles.actions}>
        {tracks.slice(0, -1).map((track, itemIndex) => (
          <button
            className={itemIndex === index ? "button primary" : "button"}
            type="button"
            aria-pressed={itemIndex === index}
            onClick={() => choosePair(itemIndex)}
            key={track.id}
          >
            {itemIndex + 1} → {itemIndex + 2}
          </button>
        ))}
        <button className="button" type="button" onClick={() => void playSequence()}>
          {playing ? "Restart sequence" : "Play sequence"}
        </button>
        {playing ? <button className="text-button" type="button" onClick={stop}>Stop</button> : null}
      </div>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <audio
        key={previous.id}
        ref={previousRef}
        src={previous.url}
        preload="metadata"
        onEnded={() => void continueToIntro()}
        onPause={() => {
          if (playing === "tail" && previousRef.current?.ended !== true) setPlaying(null);
        }}
      />
      <audio
        key={next.id}
        ref={nextRef}
        src={next.url}
        preload="metadata"
        onEnded={() => setPlaying(null)}
      />
    </div>
  );
}
