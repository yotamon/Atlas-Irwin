"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Source = "original" | "candidate" | "reference" | "mono";
type ReferenceOption = { label: string; url: string; lufs: number | null };
export type MasteringSuggestedLoop = {
  label: string;
  start: number;
  end: number;
  reason: string;
};
type CandidateGraph = {
  context: AudioContext;
  stereoGain: GainNode;
  monoGain: GainNode;
};

function dbToLinear(db: number) {
  return Math.min(1, Math.max(0, 10 ** (db / 20)));
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function sourceLabel(source: Source, reference: ReferenceOption | null) {
  if (source === "original") return "Original";
  if (source === "candidate") return "Candidate";
  if (source === "mono") return "Candidate mono";
  return reference?.label ? `Reference · ${reference.label}` : "Reference";
}

export function MasteringListenLab({
  originalUrl,
  candidateUrl,
  originalLufs,
  candidateLufs,
  references = [],
  suggestedLoops = [],
}: {
  originalUrl: string;
  candidateUrl: string;
  originalLufs: number | null;
  candidateLufs: number | null;
  references?: ReferenceOption[];
  suggestedLoops?: MasteringSuggestedLoop[];
}) {
  const originalRef = useRef<HTMLAudioElement | null>(null);
  const candidateRef = useRef<HTMLAudioElement | null>(null);
  const referenceRef = useRef<HTMLAudioElement | null>(null);
  const candidateGraphRef = useRef<CandidateGraph | null>(null);
  const [active, setActive] = useState<Source>("candidate");
  const [selectedReference, setSelectedReference] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loudnessMatch, setLoudnessMatch] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState<{ start: number; end: number } | null>(null);
  const [error, setError] = useState("");

  const reference = references[selectedReference] ?? null;
  const gains = useMemo(() => {
    const measuredLoudness = [originalLufs, candidateLufs, reference?.lufs ?? null]
      .filter((value): value is number => value !== null);
    const matchedTarget = measuredLoudness.length ? Math.min(...measuredLoudness) : null;
    return {
      original: matchedTarget !== null && originalLufs !== null ? dbToLinear(matchedTarget - originalLufs) : 1,
      candidate: matchedTarget !== null && candidateLufs !== null ? dbToLinear(matchedTarget - candidateLufs) : 1,
      reference: matchedTarget !== null && reference?.lufs !== null && reference?.lufs !== undefined
        ? dbToLinear(matchedTarget - reference.lufs)
        : 1,
      pairAvailable: originalLufs !== null && candidateLufs !== null,
      referenceAvailable: reference?.lufs !== null && reference?.lufs !== undefined,
    };
  }, [candidateLufs, originalLufs, reference]);

  async function ensureCandidateGraph() {
    const existing = candidateGraphRef.current;
    if (existing) {
      await existing.context.resume().catch(() => undefined);
      return true;
    }

    const candidate = candidateRef.current;
    if (!candidate) return false;
    const AudioContextConstructor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      setError("Mono audition is not supported by this browser.");
      return false;
    }

    try {
      const context = new AudioContextConstructor();
      const source = context.createMediaElementSource(candidate);
      const stereoGain = context.createGain();
      stereoGain.gain.value = 0;
      source.connect(stereoGain).connect(context.destination);

      const splitter = context.createChannelSplitter(2);
      const left = context.createGain();
      const right = context.createGain();
      const sum = context.createGain();
      const merger = context.createChannelMerger(2);
      const monoGain = context.createGain();

      left.gain.value = 0.5;
      right.gain.value = 0.5;
      sum.channelCount = 1;
      sum.channelCountMode = "explicit";
      sum.channelInterpretation = "discrete";
      monoGain.gain.value = 0;

      source.connect(splitter);
      splitter.connect(left, 0);
      splitter.connect(right, 1);
      left.connect(sum);
      right.connect(sum);
      sum.connect(merger, 0, 0);
      sum.connect(merger, 0, 1);
      merger.connect(monoGain).connect(context.destination);

      candidate.volume = 1;
      candidateGraphRef.current = { context, stereoGain, monoGain };
      await context.resume();
      return true;
    } catch {
      setError("Mono audition could not initialize. Stereo comparison is still available.");
      return false;
    }
  }

  useEffect(() => {
    const original = originalRef.current;
    const candidate = candidateRef.current;
    const referenceAudio = referenceRef.current;
    if (!original || !candidate) return;

    original.volume = active === "original" ? loudnessMatch && gains.pairAvailable ? gains.original : 1 : 0;
    if (referenceAudio) {
      referenceAudio.volume = active === "reference"
        ? loudnessMatch && gains.referenceAvailable ? gains.reference : 1
        : 0;
    }

    const graph = candidateGraphRef.current;
    if (graph) {
      candidate.volume = 1;
      graph.stereoGain.gain.value = active === "candidate"
        ? loudnessMatch && gains.pairAvailable ? gains.candidate : 1
        : 0;
      graph.monoGain.gain.value = active === "mono"
        ? loudnessMatch && gains.pairAvailable ? gains.candidate : 1
        : 0;
    } else {
      candidate.volume = active === "candidate"
        ? loudnessMatch && gains.pairAvailable ? gains.candidate : 1
        : 0;
    }
  }, [active, gains, loudnessMatch]);

  useEffect(() => {
    const original = originalRef.current;
    const candidate = candidateRef.current;
    const referenceAudio = referenceRef.current;
    if (!original || !candidate) return;

    function updatePairTime() {
      if (active === "reference") return;
      const now = original!.currentTime;
      setCurrentTime(now);
      if (loop && now >= loop.end) {
        original!.currentTime = loop.start;
        candidate!.currentTime = loop.start;
        setCurrentTime(loop.start);
        return;
      }
      if (Math.abs(candidate!.currentTime - now) > 0.08 && !candidate!.seeking) candidate!.currentTime = now;
    }

    function updateReferenceTime() {
      if (active !== "reference" || !referenceAudio) return;
      const now = referenceAudio.currentTime;
      setCurrentTime(now);
      if (loop && now >= loop.end) {
        referenceAudio.currentTime = loop.start;
        setCurrentTime(loop.start);
      }
    }

    function updateDuration() {
      const next = active === "reference"
        ? referenceAudio?.duration
        : original!.duration;
      if (typeof next === "number" && Number.isFinite(next) && next > 0) setDuration(next);
    }

    function ended() {
      setPlaying(false);
      setCurrentTime(0);
    }

    original.addEventListener("timeupdate", updatePairTime);
    original.addEventListener("loadedmetadata", updateDuration);
    original.addEventListener("ended", ended);
    referenceAudio?.addEventListener("timeupdate", updateReferenceTime);
    referenceAudio?.addEventListener("loadedmetadata", updateDuration);
    referenceAudio?.addEventListener("ended", ended);
    updateDuration();

    return () => {
      original.removeEventListener("timeupdate", updatePairTime);
      original.removeEventListener("loadedmetadata", updateDuration);
      original.removeEventListener("ended", ended);
      referenceAudio?.removeEventListener("timeupdate", updateReferenceTime);
      referenceAudio?.removeEventListener("loadedmetadata", updateDuration);
      referenceAudio?.removeEventListener("ended", ended);
    };
  }, [active, loop, reference?.url]);

  useEffect(() => () => {
    const graph = candidateGraphRef.current;
    if (graph) void graph.context.close().catch(() => undefined);
  }, []);

  async function playPair(ignoreLoop = false) {
    const original = originalRef.current;
    const candidate = candidateRef.current;
    if (!original || !candidate) return false;
    const graph = candidateGraphRef.current;
    if (graph) await graph.context.resume().catch(() => undefined);

    const anchor = !ignoreLoop && loop
      ? Math.max(loop.start, Math.min(loop.end - 0.1, original.currentTime))
      : Math.max(original.currentTime, candidate.currentTime);
    original.currentTime = anchor;
    candidate.currentTime = anchor;
    const results = await Promise.allSettled([original.play(), candidate.play()]);
    if (results.some((result) => result.status === "rejected")) {
      original.pause();
      candidate.pause();
      return false;
    }
    return true;
  }

  async function playReference(ignoreLoop = false) {
    const referenceAudio = referenceRef.current;
    if (!referenceAudio || !reference) return false;
    const anchor = !ignoreLoop && loop
      ? Math.max(loop.start, Math.min(loop.end - 0.1, referenceAudio.currentTime))
      : referenceAudio.currentTime;
    referenceAudio.currentTime = anchor;
    try {
      await referenceAudio.play();
      return true;
    } catch {
      return false;
    }
  }

  function pauseAll() {
    originalRef.current?.pause();
    candidateRef.current?.pause();
    referenceRef.current?.pause();
  }

  async function togglePlayback() {
    setError("");
    if (playing) {
      pauseAll();
      setPlaying(false);
      return;
    }

    const ok = active === "reference" ? await playReference() : await playPair();
    if (!ok) {
      pauseAll();
      setPlaying(false);
      setError("The comparison could not start. Try again or download the candidate for external comparison.");
      return;
    }
    setPlaying(true);
  }

  async function chooseSource(next: Source) {
    if (next === "reference" && !reference) return;
    if (next === "mono" && !(await ensureCandidateGraph())) return;

    const crossingReferenceBoundary = (active === "reference") !== (next === "reference");
    if (crossingReferenceBoundary) {
      pauseAll();
      setLoop(null);
    }

    setActive(next);
    const target = next === "reference" ? referenceRef.current : originalRef.current;
    if (target) {
      setCurrentTime(target.currentTime);
      setDuration(Number.isFinite(target.duration) ? target.duration : 0);
    }

    if (playing && crossingReferenceBoundary) {
      const ok = next === "reference" ? await playReference(true) : await playPair(true);
      if (!ok) {
        setPlaying(false);
        setError("The selected source could not start playback.");
      }
    }
  }

  function changeReference(index: number) {
    referenceRef.current?.pause();
    setSelectedReference(index);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setLoop(null);
  }

  function seek(next: number) {
    const value = Math.max(0, Math.min(duration || next, next));
    if (active === "reference") {
      if (referenceRef.current) referenceRef.current.currentTime = value;
    } else {
      if (originalRef.current) originalRef.current.currentTime = value;
      if (candidateRef.current) candidateRef.current.currentTime = value;
    }
    setCurrentTime(value);
  }

  async function auditionSuggestedLoop(item: MasteringSuggestedLoop) {
    const safeStart = Math.max(0, item.start);
    const safeEnd = Math.max(safeStart + 1, item.end);
    if (active === "reference") {
      await chooseSource("candidate");
    }
    setLoop({ start: safeStart, end: safeEnd });
    if (originalRef.current) originalRef.current.currentTime = safeStart;
    if (candidateRef.current) candidateRef.current.currentTime = safeStart;
    setCurrentTime(safeStart);
    setError("");
  }

  function toggleLoop() {
    if (loop) {
      setLoop(null);
      return;
    }
    const start = Math.max(0, currentTime - 2);
    const end = Math.min(duration || currentTime + 12, start + 12);
    setLoop({ start, end });
    seek(start);
  }

  const originalAttenuation = gains.pairAvailable ? 20 * Math.log10(Math.max(gains.original, 0.0001)) : 0;
  const candidateAttenuation = gains.pairAvailable ? 20 * Math.log10(Math.max(gains.candidate, 0.0001)) : 0;
  const referenceAttenuation = gains.referenceAvailable ? 20 * Math.log10(Math.max(gains.reference, 0.0001)) : null;

  return (
    <section
      className="mastering-ab-player mastering-listen-lab"
      aria-label="Listen Lab"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement || event.target instanceof HTMLSelectElement) return;
        const key = event.key.toLowerCase();
        if (key === "a") void chooseSource("original");
        if (key === "b") void chooseSource("candidate");
        if (key === "m") void chooseSource("mono");
        if (key === "r" && reference) void chooseSource("reference");
        if (event.key === " ") {
          event.preventDefault();
          void togglePlayback();
        }
      }}
    >
      <div className="mastering-ab-toolbar">
        <div>
          <span className="section-label">Listen Lab</span>
          <strong>Compare fairly before approving</strong>
        </div>
        <button className="button" type="button" onClick={togglePlayback}>{playing ? "Pause" : "Play comparison"}</button>
        <div className="mastering-ab-toggle" role="group" aria-label="Comparison source">
          <button type="button" aria-pressed={active === "original"} onClick={() => void chooseSource("original")}>A · Original</button>
          <button type="button" aria-pressed={active === "candidate"} onClick={() => void chooseSource("candidate")}>B · Candidate</button>
          <button type="button" aria-pressed={active === "mono"} onClick={() => void chooseSource("mono")}>M · Mono</button>
          {reference ? <button type="button" aria-pressed={active === "reference"} onClick={() => void chooseSource("reference")}>R · Reference</button> : null}
        </div>
        <button className="button" type="button" aria-pressed={Boolean(loop)} onClick={toggleLoop}>{loop ? "Stop loop" : "Loop 12s"}</button>
        <label className="mastering-loudness-match">
          <input
            type="checkbox"
            checked={loudnessMatch}
            disabled={!gains.pairAvailable}
            onChange={(event) => setLoudnessMatch(event.target.checked)}
          />
          <span>Loudness match</span>
        </label>
      </div>

      {suggestedLoops.length ? (
        <div className="mastering-listen-suggestions" aria-label="Suggested listening moments">
          <span className="section-label">Listen where the master changed most</span>
          <div className="mastering-listen-suggestion-list">
            {suggestedLoops.map((item, index) => (
              <button
                className="text-button"
                type="button"
                key={`${item.label}-${index}`}
                onClick={() => void auditionSuggestedLoop(item)}
                title={item.reason}
              >
                {item.label} · {formatTime(item.start)}–{formatTime(item.end)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {references.length ? (
        <label className="mastering-reference-select">
          <span>Reference track</span>
          <select
            value={selectedReference}
            onChange={(event) => changeReference(Number(event.target.value))}
          >
            {references.map((item, index) => <option value={index} key={`${item.url}-${index}`}>{item.label}</option>)}
          </select>
        </label>
      ) : null}

      <div className="mastering-ab-timeline">
        <span>{formatTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.05}
          value={Math.min(currentTime, Math.max(duration, 0.01))}
          aria-label="Comparison playback position"
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span>{formatTime(duration)}</span>
      </div>

      <div className="mastering-ab-evidence">
        <span><strong>Listening now</strong>{sourceLabel(active, reference)}</span>
        <span><strong>Loudness match</strong>{gains.pairAvailable ? loudnessMatch ? reference && !gains.referenceAvailable ? "A/B matched · reference unmeasured" : "On" : "Off" : "Unavailable"}</span>
        {loop ? <span><strong>Loop</strong>{formatTime(loop.start)}–{formatTime(loop.end)}</span> : null}
        {gains.pairAvailable && loudnessMatch ? (
          <span>
            <strong>Playback trim</strong>
            A {originalAttenuation.toFixed(1)} dB · B {candidateAttenuation.toFixed(1)} dB
            {referenceAttenuation !== null ? ` · R ${referenceAttenuation.toFixed(1)} dB` : ""}
          </span>
        ) : null}
      </div>

      <p className="v2-muted-copy">
        A/B stay sample-position synchronized. Mono is a browser-side fold-down of the candidate for translation checks.
        {reference ? " Reference playback is independent because it may be a different song." : ""}
        {" "}Keyboard: A original, B candidate, M mono{reference ? ", R reference" : ""}, Space play/pause.
      </p>
      {error ? <p className="mastering-ab-error" role="alert">{error}</p> : null}
      <audio crossOrigin="anonymous" ref={originalRef} preload="metadata" src={originalUrl} />
      <audio crossOrigin="anonymous" ref={candidateRef} preload="metadata" src={candidateUrl} />
      {reference ? <audio crossOrigin="anonymous" ref={referenceRef} preload="metadata" src={reference.url} /> : null}
    </section>
  );
}

