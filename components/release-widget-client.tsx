"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import {
  ArrowRightIcon,
  PauseIcon,
  PlayIcon,
  StarMarkIcon,
  WaveformIcon,
} from "@/components/icons";

type ReleaseTrackView = {
  number: string;
  title: string;
  duration?: string;
  file: string;
  url: string;
  active: boolean;
};

type ReleaseView = {
  slug: string;
  title: string;
  type?: string;
  artist?: string;
  coverUrl: string;
  coverAlt: string;
  ctaLabel?: string;
  releaseDateLabel?: string;
  trackCount: number;
  totalDurationLabel?: string;
  tracks: ReleaseTrackView[];
};

type ReleaseWidgetClientProps = {
  release: ReleaseView;
};

export function ReleaseWidgetClient({ release }: ReleaseWidgetClientProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const shouldAutoplayRef = useRef(false);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(() =>
    Math.max(
      0,
      release.tracks.findIndex((track) => track.active),
    ),
  );
  const [isPlaying, setIsPlaying] = useState(false);

  const selectedTrack = release.tracks[selectedTrackIndex];

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !selectedTrack) {
      return;
    }

    audio.pause();
    audio.load();

    if (!shouldAutoplayRef.current) {
      return;
    }

    shouldAutoplayRef.current = false;
    void audio.play().catch(() => {
      setIsPlaying(false);
    });
  }, [selectedTrack]);

  if (!selectedTrack) {
    return null;
  }

  const togglePlayback = () => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      void audio.play().catch(() => {
        setIsPlaying(false);
      });
      return;
    }

    audio.pause();
  };

  const playTrack = (index: number) => {
    if (index === selectedTrackIndex) {
      togglePlayback();
      return;
    }

    setSelectedTrackIndex(index);
    shouldAutoplayRef.current = true;
  };

  return (
    <section
      id="release-widget"
      className="relative z-30 mx-auto mt-6 w-full max-w-[1180px] px-5 pb-2 sm:px-8 lg:-mt-24 lg:px-0"
    >
      <div className="paper-card rounded-[1.85rem] border border-ink/35 px-4 py-4 shadow-[0_14px_30px_rgba(17,17,17,0.08)] backdrop-blur-[2px] sm:px-6 sm:py-6 lg:px-5 lg:py-4">
        <div className="grid items-stretch gap-6 lg:grid-cols-[220px_1.15fr_1.55fr_84px] lg:gap-5">
          <div className="mx-auto w-full max-w-[210px]">
            <div className="overflow-hidden rounded-[1rem] border border-ink/45 bg-paper shadow-[0_8px_18px_rgba(17,17,17,0.08)]">
              <Image
                src={release.coverUrl}
                alt={release.coverAlt}
                width={210}
                height={210}
                unoptimized
                className="h-auto w-full"
              />
            </div>
          </div>

          <div className="flex flex-col justify-center text-center lg:text-left">
            <div className="flex items-center justify-center gap-3 text-teal lg:justify-start">
              <StarMarkIcon className="h-4 w-4" />
              <p className="font-display text-[1.15rem] uppercase tracking-[0.28em] sm:text-[1.25rem]">
                New Release
              </p>
            </div>
            <h2 className="mt-3 font-display text-[3.35rem] uppercase leading-[0.88] tracking-[0.03em] sm:text-[4.05rem]">
              {release.title}
            </h2>
            {release.artist ? (
              <p className="mt-2 font-display text-[1.1rem] uppercase tracking-[0.24em] text-muted sm:text-[1.18rem]">
                {release.artist}
              </p>
            ) : null}
            <p className="mt-3 font-display text-[1.2rem] uppercase tracking-[0.2em] text-ink/80 sm:text-[1.35rem]">
              {release.type ? `${release.type} • ` : ""}
              {release.trackCount} {release.trackCount === 1 ? "Track" : "Tracks"}
              {release.totalDurationLabel ? (
                <>
                  <span className="mx-3 text-coral">•</span>
                  {release.totalDurationLabel}
                </>
              ) : null}
            </p>
            {release.releaseDateLabel ? (
              <p className="mt-2 text-[0.94rem] uppercase tracking-[0.24em] text-muted">
                Released {release.releaseDateLabel}
              </p>
            ) : null}
            <button
              type="button"
              onClick={togglePlayback}
              className="mx-auto mt-6 inline-flex min-h-14 items-center gap-4 rounded-full border border-teal px-7 py-3 font-display text-[1.4rem] uppercase tracking-[0.14em] text-ink transition-colors duration-200 hover:bg-teal/8 lg:mx-0"
            >
              <span>{isPlaying ? "Pause Audio" : release.ctaLabel || "Listen Now"}</span>
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-2.5 border-t border-ink/18 pt-2 lg:border-t-0 lg:pt-0">
            {release.tracks.map((track, index) => {
              const isActive = index === selectedTrackIndex;

              return (
                <button
                  key={`${release.slug}-${track.file}`}
                  type="button"
                  onClick={() => playTrack(index)}
                  className={`grid grid-cols-[2.3rem_1fr_auto] items-center gap-3 border-b border-ink/12 pb-2 text-left text-[0.98rem] transition-colors sm:text-[1.05rem] ${
                    isActive ? "text-teal" : "text-ink/88"
                  }`}
                >
                  <span className="font-display text-[1.35rem] uppercase tracking-[0.15em]">
                    {track.number}
                  </span>
                  <div className="flex min-w-0 items-center gap-3">
                    {isActive ? (
                      <span className="h-0 w-0 border-y-[5px] border-y-transparent border-l-[7px] border-l-teal" />
                    ) : null}
                    <span className={`${isActive ? "font-medium" : ""} truncate`}>
                      {track.title}
                    </span>
                    {isActive ? (
                      <WaveformIcon className="hidden h-4 w-20 shrink-0 md:block" />
                    ) : null}
                  </div>
                  <span className="font-display text-[1.25rem] uppercase tracking-[0.08em]">
                    {track.duration || "Audio"}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-center lg:justify-end">
            <button
              type="button"
              onClick={togglePlayback}
              aria-label={`${isPlaying ? "Pause" : "Play"} ${selectedTrack.title}`}
              className="inline-flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border border-teal text-teal transition-transform duration-200 hover:scale-105 hover:bg-teal hover:text-paper"
            >
              {isPlaying ? (
                <PauseIcon className="h-7 w-7" />
              ) : (
                <PlayIcon className="h-7 w-7 translate-x-[1px]" />
              )}
            </button>
          </div>
        </div>

        <audio ref={audioRef} preload="metadata" className="hidden">
          <source src={selectedTrack.url} />
        </audio>
      </div>
    </section>
  );
}
