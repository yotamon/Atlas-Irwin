"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { FaArrowRight, FaPause, FaPlay } from "react-icons/fa";
import { HiSparkles } from "react-icons/hi2";
import { MdGraphicEq } from "react-icons/md";

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

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const selectedTrack = release.tracks[selectedTrackIndex];

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const handleDurationChange = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("durationchange", handleDurationChange);

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("durationchange", handleDurationChange);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !selectedTrack) {
      return;
    }

    audio.pause();
    audio.load();
    setCurrentTime(0);
    setDuration(0);

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

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    audio.currentTime = (x / rect.width) * duration;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <section
      id="release-widget"
      className="relative -top-19 z-30 mx-auto -mb-19 w-full max-w-295 px-5 pb-2 sm:-top-25 sm:-mb-25 sm:px-8 lg:px-0"
    >
      <div className="paper-card rounded-[1.45rem] border border-ink/35 px-4 py-4 shadow-[0_14px_30px_rgba(17,17,17,0.08)] backdrop-blur-[2px] sm:rounded-[1.85rem] sm:px-6 sm:py-6 lg:px-5 lg:py-4">
        <div className="grid items-stretch gap-6 lg:grid-cols-[220px_1.15fr_1.55fr_84px] lg:gap-5">
          <div className="mx-auto w-full max-w-52.5">
            <div className="overflow-hidden rounded-2xl border border-ink/45 bg-paper shadow-[0_8px_18px_rgba(17,17,17,0.08)]">
              <Image
                src={release.coverUrl}
                alt={release.coverAlt}
                width={210}
                height={210}
                className="h-auto"
              />
            </div>
          </div>

          <div className="flex flex-col justify-center text-center lg:text-left">
            <div className="flex items-center justify-center gap-3 text-teal lg:justify-start">
              <HiSparkles className="h-4 w-4" />
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
              {release.trackCount}{" "}
              {release.trackCount === 1 ? "Track" : "Tracks"}
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
              aria-label={`${isPlaying ? "Pause" : "Play"} ${selectedTrack.title}`}
              className="mx-auto mt-6 inline-flex min-h-14 items-center gap-4 rounded-full border border-teal px-7 py-3 font-display text-[1.22rem] uppercase tracking-[0.14em] text-ink transition-colors duration-200 hover:bg-teal/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30 sm:text-[1.4rem] lg:mx-0"
            >
              <span>
                {isPlaying ? "Pause Audio" : release.ctaLabel || "Listen Now"}
              </span>
              <FaArrowRight className="h-4 w-4" />
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
                  aria-pressed={isActive}
                  aria-label={
                    isActive && isPlaying
                      ? `Pause Track ${track.number}: ${track.title}`
                      : `Play Track ${track.number}: ${track.title}`
                  }
                  className={`grid min-h-12 grid-cols-[2.3rem_minmax(0,1fr)_3.8rem] items-center gap-3 rounded-[0.85rem] border-b border-ink/12 px-2 py-1.5 text-left text-[0.98rem] transition-colors hover:bg-ink/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30 sm:grid-cols-[2.3rem_minmax(0,1fr)_4.4rem] sm:text-[1.05rem] ${
                    isActive ? "text-teal" : "text-ink/88"
                  }`}
                >
                  <span className="font-display text-[1.35rem] uppercase tracking-[0.15em]">
                    {track.number}
                  </span>
                  <div className="grid min-w-0 grid-cols-[0.72rem_minmax(0,1fr)_auto] items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className={`h-0 w-0 border-y-[5px] border-y-transparent border-l-[7px] border-l-teal ${
                        isActive ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    <span
                      className={`${isActive ? "font-medium" : ""} truncate`}
                    >
                      {track.title}
                    </span>
                    {isActive ? (
                      <span aria-live="polite" className="contents">
                        <span className="sr-only">
                          {isPlaying ? `Now playing: ${track.title}` : "Paused"}
                        </span>
                        <MdGraphicEq
                          aria-hidden="true"
                          className="hidden h-4 w-20 shrink-0 md:block"
                        />
                      </span>
                    ) : null}
                  </div>
                  <span className="justify-self-end font-display text-[1.18rem] uppercase tracking-[0.08em] sm:text-[1.25rem]">
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
              className="inline-flex h-18 w-18 items-center justify-center rounded-full border border-teal text-teal transition-transform duration-200 hover:scale-105 hover:bg-teal hover:text-paper"
            >
              {isPlaying ? (
                <FaPause className="h-7 w-7" />
              ) : (
                <FaPlay className="h-7 w-7 translate-x-px" />
              )}
            </button>
          </div>
        </div>

        {/* Audio progress bar */}
        <div className="mt-4 flex items-center gap-3 px-2 lg:px-0">
          <span className="min-w-10 text-right font-sans text-[0.8rem] tabular-nums text-muted">
            {formatTime(currentTime)}
          </span>
          <div
            className="relative h-1 flex-1 cursor-pointer overflow-hidden rounded-full bg-line"
            onClick={handleSeek}
            role="slider"
            aria-label="Audio progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPercent)}
            tabIndex={0}
            onKeyDown={(e) => {
              const audio = audioRef.current;
              if (!audio) return;
              if (e.key === "ArrowRight") {
                audio.currentTime = Math.min(audio.currentTime + 5, duration);
              } else if (e.key === "ArrowLeft") {
                audio.currentTime = Math.max(audio.currentTime - 5, 0);
              }
            }}
          >
            <div
              className="h-full rounded-full bg-teal transition-[width] duration-100"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="min-w-10 font-sans text-[0.8rem] tabular-nums text-muted">
            {formatTime(duration)}
          </span>
        </div>

        <audio
          ref={audioRef}
          preload="metadata"
          className="hidden"
          src={selectedTrack.url}
        />
      </div>
    </section>
  );
}
