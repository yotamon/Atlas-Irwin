"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { FaArrowRight, FaPause, FaPlay } from "react-icons/fa";
import { HiSparkles } from "react-icons/hi2";

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
  releases: ReleaseView[];
};

/* ── Animated equalizer bars ─────────────────────────────── */

function AnimatedEqualizer({
  isActive,
  className = "",
}: {
  isActive: boolean;
  className?: string;
}) {
  return (
    <span
      className={`flex h-4 items-end gap-[2.5px] ${isActive ? "eq-active" : ""} ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <span
          key={i}
          className="eq-bar"
          style={{ animationDelay: `${i * 70}ms` }}
        />
      ))}
    </span>
  );
}

/* ── Helpers ─────────────────────────────────────────────── */

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getActiveTrackIndex(release: ReleaseView): number {
  return Math.max(
    0,
    release.tracks.findIndex((track) => track.active),
  );
}

/* ── Main component ─────────────────────────────────────── */

export function ReleaseWidgetClient({ releases }: ReleaseWidgetClientProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const shouldAutoplayRef = useRef(false);
  const [selectedReleaseIndex, setSelectedReleaseIndex] = useState(0);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(() => getActiveTrackIndex(releases[0]));
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const featuredRelease = releases[selectedReleaseIndex] ?? releases[0];
  const otherReleases = releases
    .map((release, index) => ({ release, index }))
    .filter(({ index }) => index !== selectedReleaseIndex);
  const selectedTrack = featuredRelease.tracks[selectedTrackIndex];

  /* ── Audio event listeners ────────────────────────────── */
  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const handlePlay = () => {
      setIsPlaying(true);
      setIsBuffering(false);
    };
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);
    const handleWaiting = () => setIsBuffering(true);
    const handleCanPlay = () => setIsBuffering(false);
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
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("durationchange", handleDurationChange);

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("durationchange", handleDurationChange);
    };
  }, []);

  /* ── Track change ─────────────────────────────────────── */
  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !selectedTrack) {
      return;
    }

    audio.pause();
    audio.load();
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setIsBuffering(shouldAutoplayRef.current);

    if (!shouldAutoplayRef.current) {
      return;
    }

    shouldAutoplayRef.current = false;
    void audio.play().catch(() => {
      setIsPlaying(false);
      setIsBuffering(false);
    });
  }, [selectedTrack]);

  if (!selectedTrack) {
    return null;
  }

  /* ── Playback controls ────────────────────────────────── */
  const togglePlayback = () => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      setIsBuffering(true);
      void audio.play().catch(() => {
        setIsPlaying(false);
        setIsBuffering(false);
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

  const selectRelease = (index: number) => {
    const nextRelease = releases[index];

    if (!nextRelease || index === selectedReleaseIndex) {
      return;
    }

    shouldAutoplayRef.current = false;
    setSelectedReleaseIndex(index);
    setSelectedTrackIndex(getActiveTrackIndex(nextRelease));
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    audio.currentTime = (x / rect.width) * duration;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const releaseSummaryLabel = `${featuredRelease.type ? `${featuredRelease.type}, ` : ""}${
    featuredRelease.trackCount
  } ${featuredRelease.trackCount === 1 ? "Track" : "Tracks"}${
    featuredRelease.totalDurationLabel ? `, ${featuredRelease.totalDurationLabel}` : ""
  }`;

  /* ── Render ───────────────────────────────────────────── */
  return (
    <section
      id="release-widget"
      className="relative -top-19 z-30 mx-auto -mb-19 w-full max-w-295 px-5 pb-2 sm:-top-25 sm:-mb-25 sm:px-8 lg:px-0"
    >
      {/* ── Featured release player ──────────────────────── */}
      <div className="paper-card rounded-[1.45rem] border border-ink/35 px-4 py-4 shadow-[0_14px_30px_rgba(17,17,17,0.08)] backdrop-blur-[2px] sm:rounded-[1.85rem] sm:px-6 sm:py-6 lg:px-5 lg:py-4">
        <div className="grid items-stretch gap-6 md:grid-cols-[200px_1fr] lg:grid-cols-[220px_1.15fr_1.55fr_84px] lg:gap-5">
          {/* Cover art */}
          <div className="mx-auto w-full max-w-52.5 md:mx-0">
            <div className="overflow-hidden rounded-2xl border border-ink/45 bg-paper shadow-[0_8px_18px_rgba(17,17,17,0.08)]">
              <Image
                src={featuredRelease.coverUrl}
                alt={featuredRelease.coverAlt}
                width={210}
                height={210}
                className="h-auto"
              />
            </div>
          </div>

          {/* Release info */}
          <div className="flex flex-col justify-center text-center md:text-left lg:text-left">
            <div className="flex items-center justify-center gap-3 text-teal md:justify-start">
              <HiSparkles className="h-4 w-4" />
              <p className="font-display text-[1.15rem] uppercase tracking-[0.28em] sm:text-[1.25rem]">
                New Release
              </p>
            </div>
            <h2 className="mt-3 font-display text-[3.35rem] uppercase leading-[0.88] tracking-[0.03em] sm:text-[4.05rem]">
              {featuredRelease.title}
            </h2>
            {featuredRelease.artist ? (
              <p className="mt-2 font-display text-[1.1rem] uppercase tracking-[0.24em] text-muted sm:text-[1.18rem]">
                {featuredRelease.artist}
              </p>
            ) : null}
            <p
              className="mt-3 font-display text-[1.2rem] uppercase tracking-[0.2em] text-ink/80 sm:text-[1.35rem]"
              aria-label={releaseSummaryLabel}
            >
              {featuredRelease.type ? `${featuredRelease.type} • ` : ""}
              {featuredRelease.trackCount}{" "}
              {featuredRelease.trackCount === 1 ? "Track" : "Tracks"}
              {featuredRelease.totalDurationLabel ? (
                <>
                  <span className="mx-3 text-coral" aria-hidden="true">
                    •
                  </span>
                  {featuredRelease.totalDurationLabel}
                </>
              ) : null}
            </p>
            {featuredRelease.releaseDateLabel ? (
              <p className="mt-2 text-[0.94rem] uppercase tracking-[0.24em] text-muted">
                Released {featuredRelease.releaseDateLabel}
              </p>
            ) : null}
            <button
              type="button"
              onClick={togglePlayback}
              aria-label={`${isPlaying ? "Pause" : "Play"} ${selectedTrack.title}`}
              className="mx-auto mt-6 inline-flex min-h-14 items-center gap-4 rounded-full border border-teal px-7 py-3 font-display text-[1.22rem] uppercase tracking-[0.14em] text-ink transition-colors duration-200 hover:bg-teal/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30 sm:text-[1.4rem] md:mx-0"
            >
              <span>
                {isBuffering
                  ? "Loading…"
                  : isPlaying
                    ? "Pause Audio"
                    : featuredRelease.ctaLabel || "Listen Now"}
              </span>
              <FaArrowRight className="h-4 w-4" />
            </button>
          </div>

          {/* Track list */}
          <div className="grid gap-2.5 border-t border-ink/18 pt-2 md:col-span-2 lg:col-span-1 lg:border-t-0 lg:pt-0">
            {featuredRelease.tracks.map((track, index) => {
              const isActive = index === selectedTrackIndex;

              return (
                <button
                  key={`${featuredRelease.slug}-${track.file}`}
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
                        <AnimatedEqualizer isActive={isPlaying} />
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

          {/* Circular play/pause button */}
          <div className="flex items-center justify-center border-t border-ink/10 pt-4 md:col-span-2 lg:col-span-1 lg:border-t-0 lg:pt-0 lg:justify-end">
            <button
              type="button"
              onClick={togglePlayback}
              aria-label={`${isPlaying ? "Pause" : "Play"} ${selectedTrack.title}`}
              className="inline-flex h-18 w-18 items-center justify-center rounded-full border border-teal text-teal transition-transform duration-200 hover:scale-105 hover:bg-teal hover:text-paper"
            >
              {isBuffering ? (
                <svg
                  className="h-6 w-6 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              ) : isPlaying ? (
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
            {isBuffering && (
              <div className="buffer-pulse absolute inset-0 rounded-full bg-teal/30" />
            )}
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

      {/* ── Other releases ───────────────────────────────── */}
      {otherReleases.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3 px-1 sm:grid-cols-3 lg:px-0">
          {otherReleases.map(({ release: rel, index }) => (
            <button
              key={rel.slug}
              type="button"
              onClick={() => selectRelease(index)}
              className="group overflow-hidden rounded-2xl border border-line/50 bg-surface-soft/35 p-3 text-left transition-all duration-200 hover:border-teal/30 hover:bg-surface-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30"
              aria-label={`Switch player to ${rel.title}`}
            >
              <div className="overflow-hidden rounded-xl">
                <Image
                  src={rel.coverUrl}
                  alt={rel.coverAlt}
                  width={140}
                  height={140}
                  className="h-auto w-full transition-transform duration-200 group-hover:scale-[1.04]"
                />
              </div>
              <h3 className="mt-2.5 truncate font-display text-[1.05rem] uppercase leading-none tracking-[0.06em] text-ink">
                {rel.title}
              </h3>
              <p className="mt-1 text-[0.8rem] uppercase tracking-[0.12em] text-muted">
                {rel.type} • {rel.trackCount}{" "}
                {rel.trackCount === 1 ? "Track" : "Tracks"}
              </p>
              {rel.releaseDateLabel && (
                <p className="mt-0.5 text-[0.75rem] uppercase tracking-[0.1em] text-muted/70">
                  {rel.releaseDateLabel}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
