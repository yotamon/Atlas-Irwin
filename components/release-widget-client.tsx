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
  canvasVideoUrl?: string;
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
  const canvasVideoUrl = featuredRelease.canvasVideoUrl;
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
      className="relative -top-19 z-30 mx-auto -mb-19 w-full max-w-295 scroll-mt-32 px-5 pb-2 sm:-top-25 sm:-mb-25 sm:px-8 lg:px-0"
    >
      {/* ── Featured release player ──────────────────────── */}
      <div className="paper-card rounded-[1.45rem] border border-ink/35 p-3 shadow-[0_18px_42px_rgba(17,17,17,0.1)] backdrop-blur-[2px] sm:rounded-[1.85rem] sm:p-4 lg:p-5">
        <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)] lg:gap-5">
          <div className="relative mx-auto aspect-[9/16] w-full max-w-88 overflow-hidden rounded-[1.55rem] border border-ink/35 bg-ink text-paper shadow-[0_20px_44px_rgba(17,17,17,0.18)] lg:mx-0 lg:max-w-none">
            {canvasVideoUrl ? (
              <video
                key={`${featuredRelease.slug}-canvas-stage`}
                src={canvasVideoUrl}
                muted
                autoPlay
                loop
                playsInline
                preload="metadata"
                className="h-full w-full object-cover motion-reduce:hidden"
                aria-hidden="true"
              />
            ) : (
              <Image
                src={featuredRelease.coverUrl}
                alt=""
                fill
                sizes="(min-width: 1024px) 34vw, 88vw"
                className="scale-125 object-cover opacity-75 blur-xl"
                aria-hidden="true"
              />
            )}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.2)_0%,rgba(0,0,0,0.04)_38%,rgba(0,0,0,0.72)_100%)]" />
            <div className="absolute inset-x-4 top-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3 rounded-full border border-paper/25 bg-ink/35 p-2 pr-4 backdrop-blur-md">
                <div className="h-13 w-13 shrink-0 overflow-hidden rounded-full border border-paper/30 bg-paper">
                  <Image
                    src={featuredRelease.coverUrl}
                    alt={featuredRelease.coverAlt}
                    width={52}
                    height={52}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-display text-[1rem] uppercase leading-none tracking-[0.12em] text-paper">
                    {featuredRelease.artist || "Atlas Irwin"}
                  </p>
                  <p className="mt-1 truncate text-[0.68rem] uppercase tracking-[0.2em] text-paper/70">
                    {featuredRelease.type || "Release"}
                  </p>
                </div>
              </div>
            </div>
            <div className="absolute inset-x-4 bottom-4">
              <div className="rounded-[1.2rem] border border-paper/20 bg-ink/34 p-4 backdrop-blur-md">
                <div className="flex items-end justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-display text-[1rem] uppercase tracking-[0.24em] text-teal">
                      New Release
                    </p>
                    <h2 className="mt-2 font-display text-[3.45rem] uppercase leading-[0.82] tracking-[0.03em] text-paper sm:text-[4.2rem] lg:text-[4.6rem]">
                      {featuredRelease.title}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={togglePlayback}
                    disabled={isPlayDisabled}
                    aria-label={`${isPlaying ? "Pause" : "Play"} ${selectedTrack.title}`}
                    className="inline-flex h-15 w-15 shrink-0 items-center justify-center rounded-full border border-paper/55 bg-paper text-ink transition-transform duration-200 hover:scale-105 hover:bg-teal hover:text-paper disabled:cursor-wait disabled:opacity-60 disabled:hover:scale-100"
                  >
                    {isBuffering ? (
                      <svg
                        className="h-5 w-5 animate-spin"
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
                      <FaPause className="h-5 w-5" />
                    ) : (
                      <FaPlay className="h-5 w-5 translate-x-px" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col rounded-[1.35rem] border border-line/70 bg-surface-soft/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] sm:p-5 lg:p-6">
            <div className="flex flex-col gap-4 border-b border-ink/14 pb-5 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3 text-teal">
                  <HiSparkles className="h-4 w-4" />
                  <p className="font-display text-[1.05rem] uppercase tracking-[0.28em]">
                    Featured
                  </p>
                </div>
                <h3 className="mt-3 font-display text-[3.25rem] uppercase leading-[0.84] tracking-[0.03em] sm:text-[4.2rem]">
                  {featuredRelease.title}
                </h3>
                {featuredRelease.artist ? (
                  <p className="mt-2 font-display text-[1.05rem] uppercase tracking-[0.24em] text-muted">
                    {featuredRelease.artist}
                  </p>
                ) : null}
                <p
                  className="mt-3 font-display text-[1.12rem] uppercase tracking-[0.18em] text-ink/80"
                  aria-label={releaseSummaryLabel}
                >
                  {featuredRelease.type ? `${featuredRelease.type} • ` : ""}
                  {featuredRelease.trackCount}{" "}
                  {featuredRelease.trackCount === 1 ? "Track" : "Tracks"}
                  {featuredRelease.totalDurationLabel ? (
                    <>
                      <span className="mx-2.5 text-coral" aria-hidden="true">
                        •
                      </span>
                      {featuredRelease.totalDurationLabel}
                    </>
                  ) : null}
                </p>
                {featuredRelease.releaseDateLabel ? (
                  <p className="mt-2 text-[0.85rem] uppercase tracking-[0.22em] text-muted">
                    Released {featuredRelease.releaseDateLabel}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={togglePlayback}
                disabled={isPlayDisabled}
                aria-label={`${isPlaying ? "Pause" : "Play"} ${selectedTrack.title}`}
                className="inline-flex min-h-13 shrink-0 items-center justify-center gap-3 rounded-full border border-teal px-6 py-3 font-display text-[1.1rem] uppercase tracking-[0.14em] text-ink transition-colors duration-200 hover:bg-teal hover:text-paper disabled:cursor-wait disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-ink"
              >
                <span>
                  {playbackState === "loading-widget"
                    ? "Loading"
                    : isBuffering
                      ? "Loading"
                      : isPlaying
                        ? "Pause"
                        : featuredRelease.ctaLabel || "Listen Now"}
                </span>
                <FaArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-4 grid gap-2.5">
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
                    className={`grid min-h-12 grid-cols-[2.4rem_minmax(0,1fr)_4.1rem] items-center gap-3 rounded-[0.95rem] border px-3 py-2 text-left text-[0.98rem] transition-colors disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30 sm:grid-cols-[2.5rem_minmax(0,1fr)_4.8rem] sm:text-[1.04rem] ${
                      isActive
                        ? "border-teal/30 bg-teal/8 text-teal shadow-[0_6px_18px_rgba(15,169,162,0.08)]"
                        : "border-line/60 bg-paper/18 text-ink/84 hover:border-teal/24 hover:bg-paper/34"
                    }`}
                  >
                    <span className="font-display text-[1.24rem] uppercase tracking-[0.12em]">
                      {track.number}
                    </span>
                    <div className="grid min-w-0 grid-cols-[0.7rem_minmax(0,1fr)_auto] items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className={`h-0 w-0 border-y-[5px] border-y-transparent border-l-[7px] border-l-current ${
                          isActive ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <span className={`${isActive ? "font-medium" : ""} truncate`}>
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
                    <span className="justify-self-end font-display text-[1.05rem] uppercase tracking-[0.08em] sm:text-[1.18rem]">
                      {track.duration || "Audio"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 border-t border-ink/14 pt-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-2.5 text-[0.74rem] uppercase tracking-[0.18em] text-muted">
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
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-surface-soft/45 px-3 font-display text-[0.82rem] uppercase tracking-[0.12em] text-ink transition-colors hover:border-teal/45 hover:text-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30"
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
          </div>
        </div>

        {otherReleases.length > 0 ? (
          <div className="mt-4 border-t border-ink/14 pt-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="font-display text-[1rem] uppercase tracking-[0.24em] text-muted">
                More Releases
              </p>
              <span className="hidden h-px flex-1 bg-line/70 sm:block" aria-hidden="true" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {otherReleases.map(({ release: rel, index }) => (
                <button
                  key={rel.slug}
                  type="button"
                  onClick={() => selectRelease(index)}
                  className="group grid min-h-28 grid-cols-[5.2rem_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-[1.1rem] border border-line/65 bg-surface-soft/38 p-2.5 text-left transition-all duration-200 hover:border-teal/35 hover:bg-surface-soft/70 hover:shadow-[0_10px_24px_rgba(17,17,17,0.07)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30"
                  aria-label={`Switch player to ${rel.title}`}
                >
                  <div className="relative aspect-[9/12] overflow-hidden rounded-[0.8rem] border border-ink/16 bg-paper">
                    {rel.canvasVideoUrl ? (
                      <video
                        key={`${rel.slug}-release-shelf-canvas`}
                        src={rel.canvasVideoUrl}
                        muted
                        autoPlay
                        loop
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04] motion-reduce:hidden"
                        aria-hidden="true"
                      />
                    ) : (
                      <Image
                        src={rel.coverUrl}
                        alt=""
                        fill
                        sizes="84px"
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                        aria-hidden="true"
                      />
                    )}
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_35%,rgba(0,0,0,0.42)_100%)]" />
                    <Image
                      src={rel.coverUrl}
                      alt={rel.coverAlt}
                      width={34}
                      height={34}
                      className="absolute bottom-2 left-2 h-8.5 w-8.5 rounded-full border border-paper/70 object-cover shadow-[0_3px_10px_rgba(0,0,0,0.18)]"
                    />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-[1.35rem] uppercase leading-none tracking-[0.06em] text-ink transition-colors group-hover:text-teal">
                      {rel.title}
                    </h3>
                    <p className="mt-2 text-[0.78rem] uppercase tracking-[0.14em] text-muted">
                      {rel.type} • {rel.trackCount}{" "}
                      {rel.trackCount === 1 ? "Track" : "Tracks"}
                    </p>
                    {rel.releaseDateLabel ? (
                      <p className="mt-1 text-[0.74rem] uppercase tracking-[0.12em] text-muted/72">
                        {rel.releaseDateLabel}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper/30 text-teal transition-colors group-hover:border-teal group-hover:bg-teal group-hover:text-paper"
                    aria-hidden="true"
                  >
                    <FaArrowRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

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
              className="pointer-events-none"
              style={{
                position: "absolute",
                left: "-9999px",
                top: 0,
                width: 300,
                height: 166,
                opacity: 0,
              }}
              tabIndex={-1}
            />
          </>
        ) : null}
      </div>

    </section>
  );
}
