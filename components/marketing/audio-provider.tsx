"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { demoTrack } from "@/lib/marketing-site/content";
import { trackMarketingEvent } from "@/lib/marketing-site/analytics";

type AudioState = {
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  error: string;
  toggle: () => void;
  seek: (seconds: number) => void;
};
const AudioContext = createContext<AudioState | null>(null);

export function MarketingAudioProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const attempt = useRef(0);

  useEffect(() => {
    const element = audio.current;
    const pendingAttempt = attempt;
    const pauseOnHide = () => {
      if (document.hidden) {
        attempt.current++;
        element?.pause();
        setLoading(false);
      }
    };
    document.addEventListener("visibilitychange", pauseOnHide);
    return () => {
      pendingAttempt.current++;
      element?.pause();
      document.removeEventListener("visibilitychange", pauseOnHide);
    };
  }, []);

  useEffect(() => {
    if (!loading) return;
    const timeout = window.setTimeout(() => {
      attempt.current++;
      audio.current?.pause();
      setLoading(false);
      setError(
        "Audio is taking too long to load. Check your connection and retry.",
      );
    }, 15000);
    return () => window.clearTimeout(timeout);
  }, [loading]);

  async function toggle() {
    const element = audio.current;
    if (!element) return;
    if (!element.paused || loading) {
      attempt.current++;
      element.pause();
      setLoading(false);
      return;
    }
    const request = ++attempt.current;
    setError("");
    setLoading(true);
    if (!element.getAttribute("src")) element.src = demoTrack.audio;
    if (element.error) element.load();
    try {
      await element.play();
      if (request !== attempt.current) {
        return;
      }
      trackMarketingEvent("demo_started", { demo_track_id: demoTrack.id });
    } catch {
      if (request === attempt.current) {
        setError("Audio couldn’t load. Check your connection and try again.");
        trackMarketingEvent("audio_error");
      }
    } finally {
      if (request === attempt.current) setLoading(false);
    }
  }

  function seek(seconds: number) {
    const element = audio.current;
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = Math.min(element.duration, Math.max(0, seconds));
    setTime(element.currentTime);
  }

  return (
    <AudioContext.Provider
      value={{ playing, loading, time, duration, error, toggle, seek }}
    >
      {children}
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) =>
          setDuration(
            Number.isFinite(event.currentTarget.duration)
              ? event.currentTarget.duration
              : 0,
          )
        }
        onError={() => {
          setPlaying(false);
          setLoading(false);
          setError(
            "Audio is unavailable. You can still explore every visual example.",
          );
        }}
      />
    </AudioContext.Provider>
  );
}

export function useMarketingAudio() {
  const context = useContext(AudioContext);
  if (!context) throw new Error("Marketing audio requires its shared provider");
  return context;
}

export function audioTime(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
