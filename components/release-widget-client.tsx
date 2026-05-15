"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  FaArrowRight,
  FaExternalLinkAlt,
  FaPause,
  FaPlay,
  FaSoundcloud,
} from "react-icons/fa";
import { HiSparkles } from "react-icons/hi2";

type ReleaseLinkView = {
  platform: string;
  href: string;
  label: string;
};

type ReleaseTrackView = {
  number: string;
  title: string;
  duration?: string;
  file: string;
  url: string;
  source: "local" | "soundcloud";
  active: boolean;
  links: ReleaseLinkView[];
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

type PlaybackState =
  | "idle"
  | "loading-widget"
  | "ready"
  | "buffering"
  | "playing"
  | "paused"
  | "ended"
  | "error";

type SoundCloudWidgetEvent = {
  currentPosition?: number;
  loadedProgress?: number;
};

type SoundCloudWidget = {
  bind: (eventName: string, listener: (event?: SoundCloudWidgetEvent) => void) => void;
  unbind: (eventName: string) => void;
  play: () => void;
  pause: () => void;
  seekTo: (milliseconds: number) => void;
  getPosition: (callback: (milliseconds: number) => void) => void;
  getDuration: (callback: (milliseconds: number) => void) => void;
  isPaused: (callback: (paused: boolean) => void) => void;
};

type SoundCloudApi = {
  Widget: ((iframe: HTMLIFrameElement) => SoundCloudWidget) & {
    Events: {
      READY: string;
      PLAY: string;
      PAUSE: string;
      FINISH: string;
      PLAY_PROGRESS: string;
      LOAD_PROGRESS: string;
      ERROR?: string;
    };
  };
};

declare global {
  interface Window {
    SC?: SoundCloudApi;
  }
}

const SOUNDCLOUD_SCRIPT_SRC = "https://w.soundcloud.com/player/api.js";
const SOUNDCLOUD_READY_TIMEOUT_MS = 10_000;
const SOUNDCLOUD_PLAY_TIMEOUT_MS = 1_200;

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

function parseDurationLabel(value?: string): number | null {
  if (!value) {
    return null;
  }

  const parts = value.split(":").map((part) => Number(part));

  if (parts.length !== 2 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  return parts[0] * 60 + parts[1];
}

function getActiveTrackIndex(release: ReleaseView): number {
  return Math.max(
    0,
    release.tracks.findIndex((track) => track.active),
  );
}

function getSoundCloudWidgetUrl(trackUrl: string): string {
  const params = new URLSearchParams({
    url: trackUrl,
    auto_play: "false",
    buying: "false",
    sharing: "false",
    download: "false",
    show_comments: "false",
    show_playcount: "false",
    show_user: "true",
    hide_related: "true",
    visual: "false",
  });

  return `https://w.soundcloud.com/player/?${params.toString()}`;
}

function getTrackActions(track: ReleaseTrackView): ReleaseLinkView[] {
  const actions =
    track.source === "soundcloud"
      ? [
          {
            platform: "SoundCloud",
            href: track.url,
            label: "Open on SoundCloud",
          },
        ]
      : [];

  for (const link of track.links ?? []) {
    const isDuplicate = actions.some(
      (action) =>
        action.href === link.href ||
        action.platform.toLowerCase() === link.platform.toLowerCase(),
    );

    if (!isDuplicate) {
      actions.push(link);
    }
  }

  return actions;
}

function getStatusLabel(state: PlaybackState, isSoundCloudTrack: boolean): string {
  if (state === "loading-widget") return "Loading SoundCloud...";
  if (state === "buffering") return "Buffering...";
  if (state === "playing") return "Now playing";
  if (state === "paused") return "Paused";
  if (state === "ended") return "Ended";
  if (state === "error") return isSoundCloudTrack ? "SoundCloud unavailable" : "Audio unavailable";
  if (state === "ready") return "Ready";
  return isSoundCloudTrack ? "Preparing SoundCloud" : "Ready";
}

function safelyUseSoundCloudWidget(action: () => void) {
  try {
    action();
  } catch {
    // SoundCloud can throw if a widget iframe was already replaced during a React render.
  }
}

/* ── Main component ─────────────────────────────────────── */

export function ReleaseWidgetClient({ releases }: ReleaseWidgetClientProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const soundCloudIframeRef = useRef<HTMLIFrameElement>(null);
  const soundCloudWidgetRef = useRef<SoundCloudWidget | null>(null);
  const soundCloudProgressTimerRef = useRef<number | null>(null);
  const shouldAutoplayRef = useRef(false);
  const [selectedReleaseIndex, setSelectedReleaseIndex] = useState(0);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(() => getActiveTrackIndex(releases[0]));
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSoundCloudApiReady, setIsSoundCloudApiReady] = useState(false);
  const [soundCloudIframeElement, setSoundCloudIframeElement] = useState<HTMLIFrameElement | null>(null);

  const featuredRelease = releases[selectedReleaseIndex] ?? releases[0];
  const otherReleases = releases
    .map((release, index) => ({ release, index }))
    .filter(({ index }) => index !== selectedReleaseIndex);
  const selectedTrack = featuredRelease.tracks[selectedTrackIndex];
  const isSoundCloudTrack = selectedTrack?.source === "soundcloud";
  const isPlaying = playbackState === "playing";
  const isBuffering = playbackState === "buffering" || playbackState === "loading-widget";
  const isPlayDisabled = isSoundCloudTrack && playbackState === "loading-widget";
  const canSeek = duration > 0 && playbackState !== "loading-widget" && playbackState !== "error";
  const progressPercent = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const trackActions = selectedTrack ? getTrackActions(selectedTrack) : [];
  const statusLabel = getStatusLabel(playbackState, Boolean(isSoundCloudTrack));
  const sourceLabel = isSoundCloudTrack ? "Playing from SoundCloud" : "Playing from site audio";
  const releaseSummaryLabel = `${featuredRelease.type ? `${featuredRelease.type}, ` : ""}${
    featuredRelease.trackCount
  } ${featuredRelease.trackCount === 1 ? "Track" : "Tracks"}${
    featuredRelease.totalDurationLabel ? `, ${featuredRelease.totalDurationLabel}` : ""
  }`;

  const setSoundCloudIframeRef = useCallback((node: HTMLIFrameElement | null) => {
    soundCloudIframeRef.current = node;
    setSoundCloudIframeElement(node);
  }, []);

  const stopSoundCloudProgressTimer = useCallback(() => {
    if (soundCloudProgressTimerRef.current !== null) {
      window.clearInterval(soundCloudProgressTimerRef.current);
      soundCloudProgressTimerRef.current = null;
    }
  }, []);

  const syncSoundCloudProgress = useCallback((widget: SoundCloudWidget) => {
    widget.getPosition((milliseconds) => {
      if (milliseconds && isFinite(milliseconds)) {
        setCurrentTime(milliseconds / 1000);
      }
    });
    widget.getDuration((milliseconds) => {
      if (milliseconds && isFinite(milliseconds)) {
        setDuration(milliseconds / 1000);
      }
    });
  }, []);

  const startSoundCloudProgressTimer = useCallback(
    (widget: SoundCloudWidget) => {
      stopSoundCloudProgressTimer();
      syncSoundCloudProgress(widget);
      soundCloudProgressTimerRef.current = window.setInterval(() => {
        syncSoundCloudProgress(widget);
      }, 500);
    },
    [stopSoundCloudProgressTimer, syncSoundCloudProgress],
  );

  useEffect(() => {
    if (!isSoundCloudTrack || isSoundCloudApiReady) {
      return;
    }

    if (window.SC?.Widget) {
      queueMicrotask(() => setIsSoundCloudApiReady(true));
      return;
    }

    const intervalId = window.setInterval(() => {
      if (window.SC?.Widget) {
        setIsSoundCloudApiReady(true);
        window.clearInterval(intervalId);
      }
    }, 100);

    return () => window.clearInterval(intervalId);
  }, [isSoundCloudTrack, isSoundCloudApiReady]);

  /* ── Audio event listeners ────────────────────────────── */
  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const handlePlay = () => {
      setPlaybackState("playing");
      setPlaybackError(null);
    };
    const handlePause = () => setPlaybackState("paused");
    const handleEnded = () => setPlaybackState("ended");
    const handleWaiting = () => setPlaybackState("buffering");
    const handleCanPlay = () => setPlaybackState((state) => (state === "buffering" ? "ready" : state));
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleError = () => {
      setPlaybackState("error");
      setPlaybackError("This audio file could not be played.");
    };
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
    audio.addEventListener("error", handleError);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("durationchange", handleDurationChange);

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("durationchange", handleDurationChange);
    };
  }, []);

  /* ── Track change ─────────────────────────────────────── */
  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !selectedTrack || selectedTrack.source === "soundcloud") {
      audio?.pause();
      return;
    }

    audio.pause();
    audio.load();

    queueMicrotask(() => {
      setPlaybackState(shouldAutoplayRef.current ? "buffering" : "ready");
      setPlaybackError(null);
      setCurrentTime(0);
      setDuration(parseDurationLabel(selectedTrack.duration) ?? 0);
    });

    if (!shouldAutoplayRef.current) {
      return;
    }

    shouldAutoplayRef.current = false;
    void audio.play().catch(() => {
      setPlaybackState("error");
      setPlaybackError("This audio file could not be played.");
    });
  }, [selectedTrack]);

  useEffect(() => {
    const previousWidget = soundCloudWidgetRef.current;
    if (previousWidget) {
      safelyUseSoundCloudWidget(() => previousWidget.pause());
    }
    soundCloudWidgetRef.current = null;

    if (!selectedTrack || selectedTrack.source !== "soundcloud") {
      return;
    }

    const iframe = soundCloudIframeElement;
    let cancelled = false;
    let isReady = false;
    const autoplay = shouldAutoplayRef.current;
    const manifestDuration = parseDurationLabel(selectedTrack.duration);

    audioRef.current?.pause();
    stopSoundCloudProgressTimer();

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      setPlaybackState("loading-widget");
      setPlaybackError(null);
      setCurrentTime(0);
      setDuration(manifestDuration ?? 0);
    });

    const timeoutId = window.setTimeout(() => {
      if (!cancelled && !isReady) {
        setPlaybackState("error");
        setPlaybackError("SoundCloud took too long to load this track.");
      }
    }, SOUNDCLOUD_READY_TIMEOUT_MS);

    const soundCloudApi = window.SC;

    const iframeTrackUrl = iframe ? new URL(iframe.src).searchParams.get("url") : null;

    if (!iframe || iframeTrackUrl !== selectedTrack.url || !soundCloudApi?.Widget) {
      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    }

    const widget = soundCloudApi.Widget(iframe);
    const events = soundCloudApi.Widget.Events;
    soundCloudWidgetRef.current = widget;

    const markReady = () => {
      if (cancelled) {
        return;
      }

      isReady = true;
      window.clearTimeout(timeoutId);
      widget.getDuration((milliseconds) => {
        if (!cancelled && milliseconds && isFinite(milliseconds)) {
          setDuration(milliseconds / 1000);
        }
      });

      if (!autoplay && !shouldAutoplayRef.current) {
        setPlaybackState((state) => (state === "loading-widget" ? "ready" : state));
        return;
      }

      shouldAutoplayRef.current = false;
      setPlaybackState("buffering");
      widget.play();
    };

    const handleReady = () => markReady();

    const handleWidgetError = () => {
      if (!cancelled) {
        setPlaybackState("error");
        setPlaybackError("SoundCloud could not play this track here.");
      }
    };

    widget.bind(events.READY, handleReady);
    widget.bind(events.PLAY, () => {
      setPlaybackState("playing");
      setPlaybackError(null);
      startSoundCloudProgressTimer(widget);
    });
    widget.bind(events.PAUSE, () => {
      stopSoundCloudProgressTimer();
      setPlaybackState("paused");
    });
    widget.bind(events.FINISH, () => {
      stopSoundCloudProgressTimer();
      setPlaybackState("ended");
    });
    widget.bind(events.PLAY_PROGRESS, (event) => {
      if (typeof event?.currentPosition === "number") {
        setCurrentTime(event.currentPosition / 1000);
      }
    });
    widget.bind(events.LOAD_PROGRESS, () => {
      setPlaybackState((state) => (state === "loading-widget" ? "ready" : state));
    });
    if (events.ERROR) {
      widget.bind(events.ERROR, handleWidgetError);
    }
    widget.getDuration((milliseconds) => {
      if (!cancelled && !isReady && milliseconds && isFinite(milliseconds)) {
        markReady();
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      stopSoundCloudProgressTimer();
      const activeWidget = soundCloudWidgetRef.current;

      if (activeWidget) {
        safelyUseSoundCloudWidget(() => {
          activeWidget.unbind(events.READY);
          activeWidget.unbind(events.PLAY);
          activeWidget.unbind(events.PAUSE);
          activeWidget.unbind(events.FINISH);
          activeWidget.unbind(events.PLAY_PROGRESS);
          activeWidget.unbind(events.LOAD_PROGRESS);
          if (events.ERROR) {
            activeWidget.unbind(events.ERROR);
          }
          activeWidget.pause();
        });
      }
    };
  }, [
    selectedTrack,
    soundCloudIframeElement,
    isSoundCloudApiReady,
    startSoundCloudProgressTimer,
    stopSoundCloudProgressTimer,
  ]);

  if (!selectedTrack) {
    return null;
  }

  const getSoundCloudWidget = (): SoundCloudWidget | null => {
    if (soundCloudWidgetRef.current) {
      return soundCloudWidgetRef.current;
    }

    const iframe = soundCloudIframeRef.current;
    const iframeTrackUrl = iframe ? new URL(iframe.src).searchParams.get("url") : null;

    if (!window.SC?.Widget || !iframe || iframeTrackUrl !== selectedTrack.url) {
      return null;
    }

    const widget = window.SC.Widget(iframe);
    soundCloudWidgetRef.current = widget;
    widget.getDuration((milliseconds) => {
      if (milliseconds && isFinite(milliseconds)) {
        setDuration(milliseconds / 1000);
      }
    });
    return widget;
  };

  const playSelectedTrack = () => {
    setPlaybackError(null);

    if (isSoundCloudTrack) {
      const widget = getSoundCloudWidget();

      if (!widget) {
        shouldAutoplayRef.current = true;
        setPlaybackState("loading-widget");
        return;
      }

      setPlaybackState("buffering");
      widget.play();
      window.setTimeout(() => {
        widget.isPaused((isStillPaused) => {
          if (isStillPaused) {
            stopSoundCloudProgressTimer();
            setPlaybackState("error");
            setPlaybackError("SoundCloud did not start playback. Open the track on SoundCloud instead.");
            return;
          }

          setPlaybackState("playing");
          startSoundCloudProgressTimer(widget);
        });
      }, SOUNDCLOUD_PLAY_TIMEOUT_MS);
      return;
    }

    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    setPlaybackState("buffering");
    void audio.play().catch(() => {
      setPlaybackState("error");
      setPlaybackError("This audio file could not be played.");
    });
  };

  const pauseSelectedTrack = () => {
    if (isSoundCloudTrack) {
      const widget = getSoundCloudWidget();
      if (widget) {
        safelyUseSoundCloudWidget(() => widget.pause());
      }
      stopSoundCloudProgressTimer();
      setPlaybackState("paused");
      return;
    }

    audioRef.current?.pause();
    setPlaybackState("paused");
  };

  const seekSelectedTrack = (nextTime: number) => {
    if (!canSeek) {
      return;
    }

    const clampedTime = Math.min(Math.max(nextTime, 0), duration);

    if (isSoundCloudTrack) {
      getSoundCloudWidget()?.seekTo(clampedTime * 1000);
      setCurrentTime(clampedTime);
      return;
    }

    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = clampedTime;
    }
  };

  /* ── Playback controls ────────────────────────────────── */
  const togglePlayback = () => {
    if (isPlayDisabled) {
      return;
    }

    if (isPlaying) {
      pauseSelectedTrack();
      return;
    }

    playSelectedTrack();
  };

  const playTrack = (index: number) => {
    if (index === selectedTrackIndex) {
      togglePlayback();
      return;
    }

    const nextTrack = featuredRelease.tracks[index];
    setCurrentTime(0);
    setDuration(parseDurationLabel(nextTrack?.duration) ?? 0);
    setPlaybackError(null);
    setPlaybackState(nextTrack?.source === "soundcloud" ? "loading-widget" : "buffering");
    setSelectedTrackIndex(index);
    shouldAutoplayRef.current = true;
  };

  const selectRelease = (index: number) => {
    const nextRelease = releases[index];

    if (!nextRelease || index === selectedReleaseIndex) {
      return;
    }

    pauseSelectedTrack();
    shouldAutoplayRef.current = false;
    const nextTrack = nextRelease.tracks[getActiveTrackIndex(nextRelease)];
    setCurrentTime(0);
    setDuration(parseDurationLabel(nextTrack?.duration) ?? 0);
    setPlaybackError(null);
    setPlaybackState(nextTrack?.source === "soundcloud" ? "loading-widget" : "ready");
    setSelectedReleaseIndex(index);
    setSelectedTrackIndex(getActiveTrackIndex(nextRelease));
  };

  const seekFromPointer = (clientX: number, element: HTMLDivElement) => {
    if (!canSeek) return;
    const rect = element.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    seekSelectedTrack((x / rect.width) * duration);
  };

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
              disabled={isPlayDisabled}
              aria-label={`${isPlaying ? "Pause" : "Play"} ${selectedTrack.title}`}
              className="mx-auto mt-6 inline-flex min-h-14 items-center gap-4 rounded-full border border-teal px-7 py-3 font-display text-[1.22rem] uppercase tracking-[0.14em] text-ink transition-colors duration-200 hover:bg-teal/8 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30 sm:text-[1.4rem] md:mx-0"
            >
              <span>
                {playbackState === "loading-widget"
                  ? "Loading SoundCloud..."
                  : isBuffering
                    ? "Loading..."
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
                  disabled={isActive && isPlayDisabled}
                  aria-pressed={isActive}
                  aria-label={
                    isActive && isPlaying
                      ? `Pause Track ${track.number}: ${track.title}`
                      : `Play Track ${track.number}: ${track.title}`
                  }
                  className={`grid min-h-12 grid-cols-[2.3rem_minmax(0,1fr)_3.8rem] items-center gap-3 rounded-[0.85rem] border-b border-ink/12 px-2 py-1.5 text-left text-[0.98rem] transition-colors hover:bg-ink/[0.035] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30 sm:grid-cols-[2.3rem_minmax(0,1fr)_4.4rem] sm:text-[1.05rem] ${
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
                          {isPlaying ? `Now playing: ${track.title}` : statusLabel}
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
              disabled={isPlayDisabled}
              aria-label={`${isPlaying ? "Pause" : "Play"} ${selectedTrack.title}`}
              className="inline-flex h-18 w-18 items-center justify-center rounded-full border border-teal text-teal transition-transform duration-200 hover:scale-105 hover:bg-teal hover:text-paper disabled:cursor-wait disabled:opacity-60 disabled:hover:scale-100 disabled:hover:bg-transparent disabled:hover:text-teal"
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

        {/* Playback deck */}
        <div className="mt-5 border-t border-ink/15 px-1 pt-4 lg:px-0">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-2.5 text-[0.76rem] uppercase tracking-[0.18em] text-muted">
              {isSoundCloudTrack ? (
                <FaSoundcloud className="h-4 w-4 shrink-0 text-[#ff5500]" aria-hidden="true" />
              ) : (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-teal" aria-hidden="true" />
              )}
              <span className="truncate">{sourceLabel}</span>
              <span className="hidden text-coral sm:inline" aria-hidden="true">
                •
              </span>
              <span className="truncate text-ink/70">{statusLabel}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {trackActions.map((action) => (
                <a
                  key={`${action.platform}-${action.href}`}
                  href={action.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-surface-soft/45 px-3 font-display text-[0.86rem] uppercase tracking-[0.12em] text-ink transition-colors hover:border-teal/45 hover:text-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30"
                >
                  <span>{action.platform}</span>
                  <FaExternalLinkAlt className="h-2.5 w-2.5" aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>

          {playbackError ? (
            <div className="mt-3 flex flex-col gap-2 border-l-2 border-coral pl-3 text-[0.82rem] uppercase tracking-[0.14em] text-muted sm:flex-row sm:items-center sm:justify-between">
              <p>{playbackError}</p>
              {isSoundCloudTrack ? (
                <a
                  href={selectedTrack.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-display text-[0.92rem] text-teal transition-colors hover:text-coral"
                >
                  Open on SoundCloud
                  <FaExternalLinkAlt className="h-2.5 w-2.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-[3.2rem_minmax(0,1fr)_3.2rem] items-center gap-3">
            <span className="text-right font-sans text-[0.82rem] tabular-nums text-muted">
              {formatTime(currentTime)}
            </span>
            <div
              className={`group relative h-4 rounded-full py-[5px] ${
                canSeek ? "cursor-pointer" : "cursor-default opacity-70"
              }`}
              onClick={(e) => seekFromPointer(e.clientX, e.currentTarget)}
              onPointerDown={(e) => {
                if (!canSeek) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                seekFromPointer(e.clientX, e.currentTarget);
              }}
              onPointerMove={(e) => {
                if (!canSeek || e.buttons !== 1) return;
                seekFromPointer(e.clientX, e.currentTarget);
              }}
              role="slider"
              aria-label="Audio progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progressPercent)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  seekSelectedTrack(currentTime + 5);
                } else if (e.key === "ArrowLeft") {
                  seekSelectedTrack(currentTime - 5);
                }
              }}
            >
              <div className="relative h-full overflow-hidden rounded-full bg-line">
                {isBuffering ? (
                  <div className="buffer-pulse absolute inset-0 rounded-full bg-teal/30" />
                ) : null}
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-teal shadow-[0_0_12px_rgba(31,151,141,0.35)] transition-[width] duration-150"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-paper bg-teal opacity-0 shadow-[0_2px_8px_rgba(17,17,17,0.16)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                style={{ left: `${progressPercent}%` }}
                aria-hidden="true"
              />
            </div>
            <span className="font-sans text-[0.82rem] tabular-nums text-muted">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        <audio
          ref={audioRef}
          preload="metadata"
          className="hidden"
          src={isSoundCloudTrack ? undefined : selectedTrack.url}
        />
        {isSoundCloudTrack ? (
          <>
            <script
              src={SOUNDCLOUD_SCRIPT_SRC}
              async
              onLoad={() => setIsSoundCloudApiReady(true)}
              onError={() => {
                setPlaybackState("error");
                setPlaybackError("SoundCloud could not be loaded.");
              }}
            />
            <iframe
              key={selectedTrack.url}
              ref={setSoundCloudIframeRef}
              title={`SoundCloud player for ${selectedTrack.title}`}
              src={getSoundCloudWidgetUrl(selectedTrack.url)}
              allow="autoplay; encrypted-media"
              aria-hidden="true"
              className="pointer-events-none absolute -left-[9999px] top-0 h-[166px] w-[300px] opacity-0"
              tabIndex={-1}
            />
          </>
        ) : null}
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
