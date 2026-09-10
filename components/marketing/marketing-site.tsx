"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { EnsemblisMark } from "@/components/ensemblis-logo";
import {
  ANALYZE_URL,
  demoTrack,
  faqs,
  marketingPath,
  pillars,
  waveform,
  type PillarId,
} from "@/lib/marketing-site/content";
import { trackMarketingEvent } from "@/lib/marketing-site/analytics";
import {
  audioTime,
  MarketingAudioProvider,
  useMarketingAudio,
} from "./audio-provider";
import s from "./marketing.module.css";

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h16m-6-6 6 6-6 6"}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function AnalyzeLink({
  section = "page",
  compact = false,
}: {
  section?: string;
  compact?: boolean;
}) {
  return (
    <Link
      className={`${s.cta} ${compact ? s.compact : ""}`}
      href={ANALYZE_URL}
      onClick={() => trackMarketingEvent("analyze_clicked", { section })}
    >
      Analyze a track <Arrow />
    </Link>
  );
}

function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const sentinel = document.getElementById("marketing-top");
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) =>
      setScrolled(!entry.isIntersecting),
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (!nav.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  return (
    <header className={`${s.header} ${scrolled ? s.scrolled : ""}`}>
      <nav ref={nav} className={s.nav} aria-label="Main navigation">
        <Link
          className={s.brand}
          href={marketingPath()}
          aria-label="Ensemblis home"
        >
          <EnsemblisMark />
          <span>ensemblis</span>
        </Link>
        <button
          ref={menuButton}
          className={s.menuButton}
          aria-expanded={open}
          aria-controls="marketing-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen(!open)}
        >
          <span />
          <span />
        </button>
        <div
          id="marketing-menu"
          className={`${s.navLinks} ${open ? s.menuOpen : ""}`}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          <Link href={marketingPath("#understanding")}>The idea</Link>
          <Link href={marketingPath("#possibilities")}>Product</Link>
          <Link href={marketingPath("#demo")}>Listen & explore</Link>
          <Link href={marketingPath("/pricing")}>Access</Link>
          <Link className={s.signIn} href="/studio/login">
            Sign in <span aria-hidden="true">↗</span>
          </Link>
          <AnalyzeLink section="navigation" compact />
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className={s.footer}>
      <div className={s.footerTop}>
        <div>
          <Link className={s.brand} href={marketingPath()}>
            <EnsemblisMark />
            <span>ensemblis</span>
          </Link>
          <p>Your music. Understood.</p>
        </div>
        <div>
          <span className={s.eyebrow}>The product</span>
          {pillars.map((p) => (
            <Link key={p.id} href={marketingPath(`/${p.id}`)}>
              {p.label}
            </Link>
          ))}
        </div>
        <div>
          <span className={s.eyebrow}>Explore</span>
          <Link href={marketingPath("#demo")}>Interactive example</Link>
          <Link href={marketingPath("/about")}>Our approach</Link>
          <Link href={marketingPath("/pricing")}>Access & pricing</Link>
          <Link href={marketingPath("#questions")}>Questions</Link>
        </div>
        <div>
          <span className={s.eyebrow}>Your next move</span>
          <Link href={ANALYZE_URL}>
            Analyze a track <span aria-hidden="true">↗</span>
          </Link>
          <Link href="/studio/login">Sign in to Studio</Link>
          <p>
            Built around your music.
            <br />
            Not instead of it.
          </p>
        </div>
      </div>
      <div className={s.footerBottom}>
        <span>© {new Date().getFullYear()} Ensemblis</span>
        <span>Made for the ones who make music.</span>
        <a href="#marketing-top">Back to top ↑</a>
      </div>
    </footer>
  );
}

export function MarketingShell({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (entry.target as HTMLElement).dataset.visible = "true";
          const pillar = (entry.target as HTMLElement).dataset.pillar;
          if (pillar) trackMarketingEvent("pillar_viewed", { pillar });
          observer.unobserve(entry.target);
        }),
      { threshold: 0.16 },
    );
    root.current
      ?.querySelectorAll("[data-reveal]")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className={`${s.site} marketing-root`}>
      <div id="marketing-top" className={s.sentinel} />
      <a className={s.skip} href="#marketing-content">
        Skip to content
      </a>
      <Nav />
      <MarketingAudioProvider>{children}</MarketingAudioProvider>
      <Footer />
    </div>
  );
}

type WaveMode = "raw" | "structure" | "energy" | "dynamics" | "moment";
function Waveform({
  mode = "raw",
  hero = false,
  progress = 0,
  secondary = false,
}: {
  mode?: WaveMode;
  hero?: boolean;
  progress?: number;
  secondary?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const momentX =
    (demoTrack.example.momentStart / demoTrack.example.durationMs) * 880;
  const momentWidth =
    ((demoTrack.example.momentEnd - demoTrack.example.momentStart) /
      demoTrack.example.durationMs) *
    880;
  return (
    <div className={`${s.waveform} ${hero ? s.heroWave : ""}`} data-mode={mode}>
      <svg viewBox="0 0 880 240" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <clipPath id={`${id}-played`}>
            <rect
              width={Math.max(0, Math.min(1, progress)) * 880}
              height="240"
            />
          </clipPath>
        </defs>
        <g className={s.waveGrid}>
          {[0, 176, 352, 528, 704, 879].map((x) => (
            <path key={x} d={`M${x} 0v240`} />
          ))}
          <path d="M0 120h880" />
        </g>
        {(mode === "structure" || hero) && (
          <g className={s.structureBands}>
            {demoTrack.sections.map((section) => (
              <rect
                key={section.id}
                x={(section.start_ms / demoTrack.example.durationMs) * 880}
                y="26"
                width={
                  ((section.end_ms - section.start_ms) /
                    demoTrack.example.durationMs) *
                    880 -
                  2
                }
                height="188"
              />
            ))}
          </g>
        )}
        <g className={secondary ? s.secondarySignal : s.signal}>
          {waveform.map((height, i) => (
            <path key={i} d={`M${i * 5 + 2} ${120 - height}v${height * 2}`} />
          ))}
        </g>
        <g className={s.playedSignal} clipPath={`url(#${id}-played)`}>
          {waveform.map((height, i) => (
            <path key={i} d={`M${i * 5 + 2} ${120 - height}v${height * 2}`} />
          ))}
        </g>
        {(mode === "energy" || hero) && (
          <path
            className={s.energyCurve}
            d="M0 176 C80 180 100 138 160 150 S240 158 294 65 S345 104 400 54 S450 42 510 64 S580 145 625 98 S735 98 790 141 S845 174 880 170"
          />
        )}
        {(mode === "moment" || hero) && (
          <g className={s.momentRegion}>
            <rect x={momentX} y="15" width={momentWidth} height="210" />
            <path
              d={`M${momentX} 28V15h15m${momentWidth - 30} 0h15v13M${momentX} 212v13h15m${momentWidth - 30} 0h15v-13`}
            />
          </g>
        )}
        {progress > 0 && (
          <path className={s.playhead} d={`M${progress * 880} 0v240`} />
        )}
      </svg>
      {hero && (
        <div className={s.scan}>
          <span />
          <small>READING THE SIGNAL</small>
        </div>
      )}
      <div className={s.waveTime}>
        <span>00:00</span>
        <span>REAL WAVEFORM / EXAMPLE OVERLAYS</span>
        <span>{audioTime(demoTrack.example.durationMs / 1000)}</span>
      </div>
    </div>
  );
}

function PlayButton({ label = "Listen to the track" }: { label?: string }) {
  const audio = useMarketingAudio();
  return (
    <button
      className={s.playButton}
      onClick={audio.toggle}
      aria-label={
        audio.loading
          ? "Cancel audio loading"
          : audio.playing
            ? "Pause track"
            : label
      }
    >
      <span className={s.playIcon} aria-hidden="true">
        {audio.loading ? "···" : audio.playing ? "Ⅱ" : "▷"}
      </span>
      {audio.loading ? "Loading audio…" : audio.playing ? "Pause track" : label}
    </button>
  );
}

function Hero() {
  const [replay, setReplay] = useState(0);
  useEffect(() => {
    trackMarketingEvent("homepage_viewed");
  }, []);
  return (
    <section className={s.hero} aria-labelledby="hero-heading">
      <div className={s.heroTopline}>
        <span className={s.eyebrow}>
          <i /> Music intelligence, in your hands
        </span>
        <span className={s.edition}>ENSEMBLIS / VOL. 001</span>
      </div>
      <div className={s.heroGrid}>
        <div className={s.heroCopy}>
          <h1 id="hero-heading">
            Your music.
            <br />
            <em>Understood.</em>
          </h1>
          <p>
            Understand it. Refine it. Mix it. Promote it.
            <br />
            One intelligence, built around your sound.
          </p>
          <div className={s.heroActions}>
            <AnalyzeLink section="hero" />
            <a className={s.textLink} href="#demo">
              See how it works <span aria-hidden="true">↘</span>
            </a>
          </div>
          <span className={s.heroNote}>
            For artists, producers and DJs.{" "}
            <span>Existing account required.</span>
          </span>
        </div>
        <div key={replay} className={s.heroInstrument}>
          <div className={s.trackStrip}>
            <span className={s.trackNumber}>A / 01</span>
            <div>
              <strong>{demoTrack.title}</strong>
              <span>
                {demoTrack.artist} · {demoTrack.provenance}
              </span>
            </div>
            <button
              className={s.replay}
              onClick={() => setReplay(replay + 1)}
              aria-label="Replay analysis animation"
            >
              ↻
            </button>
          </div>
          <div className={s.heroAnnotation}>
            <span>ONE TRACK. A WORLD INSIDE.</span>
            <span className={s.signalLabel}>
              <i /> Signal resolved
            </span>
          </div>
          <Waveform hero />
          <div className={s.heroMetrics}>
            {[
              ["122", "BPM", ".8s"],
              ["F minor", "KEY", "1.1s"],
              ["01:14", "STRONG MOMENT", "2.1s"],
            ].map(([value, label, delay]) => (
              <div key={label} style={{ "--delay": delay } as CSSProperties}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className={s.heroBranches}>
            {pillars.map((p) => (
              <a href={`#${p.id}`} key={p.id}>
                <small>{p.number}</small>
                {p.label}
                <span>↗</span>
              </a>
            ))}
          </div>
        </div>
      </div>
      <div className={s.heroBottom}>
        <a href="#understanding">
          <span className={s.downArrow}>↓</span> Follow the signal
        </a>
        <span>You made the music. Let’s take it further.</span>
        <span>01 — 04</span>
      </div>
    </section>
  );
}

const modeCopy: Record<
  Exclude<WaveMode, "raw">,
  { label: string; title: string; copy: string }
> = {
  structure: {
    label: "Structure",
    title: "Every track has an architecture.",
    copy: "See how the intro, groove, lift and hook connect. A map to the decisions inside your music.",
  },
  energy: {
    label: "Energy",
    title: "Follow the rise. Feel the release.",
    copy: "Trace the tension and the payoff. Energy makes a track move long before it reaches a dance floor.",
  },
  dynamics: {
    label: "Dynamics",
    title: "Space is part of the sound.",
    copy: "Look beyond volume. Understand the contrast between quiet detail, movement and the moments that hit.",
  },
  moment: {
    label: "Strong moments",
    title: "Find the part they’ll remember.",
    copy: "An illustrative 13-second hook, from 01:14 to 01:27. A focused starting point for your next teaser.",
  },
};

function AnalysisInstrument({
  initialMode = "structure",
  progress = 0,
}: {
  initialMode?: Exclude<WaveMode, "raw">;
  progress?: number;
}) {
  const [mode, setMode] = useState<Exclude<WaveMode, "raw">>(initialMode);
  const id = useId();
  return (
    <div className={s.analysisInstrument}>
      <div
        className={s.segmented}
        role="group"
        aria-label="Track visualization"
      >
        {Object.entries(modeCopy).map(([key, value]) => (
          <button
            key={key}
            aria-pressed={mode === key}
            aria-controls={id}
            onClick={() => setMode(key as typeof mode)}
          >
            {value.label}
          </button>
        ))}
      </div>
      <div id={id}>
        <Waveform mode={mode} progress={progress} />
        <div className={s.structureLabels}>
          {demoTrack.sections.map((section) => (
            <span
              key={section.id}
              style={{ flex: section.end_ms - section.start_ms }}
            >
              {section.label}
            </span>
          ))}
        </div>
        <div className={s.insight} aria-live="polite">
          <span className={s.insightDot} />
          <div>
            <strong>{modeCopy[mode].title}</strong>
            <p>{modeCopy[mode].copy}</p>
          </div>
          <span className={s.exampleLabel}>EXAMPLE</span>
        </div>
      </div>
    </div>
  );
}

function Intelligence() {
  return (
    <section
      className={`${s.section} ${s.intelligence}`}
      id="understanding"
      data-reveal
    >
      <div className={s.sectionHeading}>
        <span className={s.eyebrow}>Listen closer</span>
        <h2>
          One track contains
          <br />
          <em>more than audio.</em>
        </h2>
        <p>
          Rhythm. Character. Tension. Release.
          <br />
          Ensemblis connects what’s inside your music to what you do next.
        </p>
      </div>
      <AnalysisInstrument />
      <div className={s.intelligenceFoot}>
        <span>
          MUSICAL <b>Tempo · Key · Character</b>
        </span>
        <span>
          SONIC <b>Dynamics · Balance · Loudness</b>
        </span>
        <span>
          STRUCTURAL <b>Sections · Hooks · Moments</b>
        </span>
      </div>
    </section>
  );
}

function PillarCopy({ id }: { id: PillarId }) {
  const pillar = pillars.find((p) => p.id === id)!;
  return (
    <div className={s.pillarCopy}>
      <span className={s.eyebrow}>
        {pillar.number} / {pillar.label}
        <span className={s.beta}>Beta</span>
      </span>
      <h2>{pillar.title}</h2>
      <p>{pillar.description}</p>
      <Link className={s.textLink} href={marketingPath(`/${id}`)}>
        {pillar.link}
        <Arrow diagonal />
      </Link>
    </div>
  );
}

function RefineInstrument() {
  const [master, setMaster] = useState(false);
  return (
    <div className={s.refineInstrument}>
      <div className={s.instrumentHeader}>
        <span className={s.eyebrow}>Same music. A considered finish.</span>
        <span className={s.exampleLabel}>VISUAL EXAMPLE</span>
      </div>
      <div
        className={s.segmented}
        role="group"
        aria-label="Mastering visualization"
      >
        <button aria-pressed={!master} onClick={() => setMaster(false)}>
          Original
        </button>
        <button aria-pressed={master} onClick={() => setMaster(true)}>
          Mastering direction
        </button>
      </div>
      <div className={master ? s.masterSelected : ""}>
        <Waveform mode="dynamics" />
      </div>
      <div className={s.refineReadouts}>
        <div>
          <span>TONAL BALANCE</span>
          <div className={s.balanceBars}>
            {[38, 66, 86, 58, 76, 44, 30].map((height, i) => (
              <i
                key={i}
                style={{
                  transform: `scaleY(${(master ? height * 0.86 + 6 : height) / 100})`,
                }}
              />
            ))}
          </div>
          <small>
            LOW <span>MID</span> HIGH
          </small>
        </div>
        <div>
          <span>THE INTENTION</span>
          <strong>{master ? "Keep the punch." : "Hear the space."}</strong>
          <p>
            {master
              ? "Refine the balance. Preserve the movement."
              : "Understand the source before making a change."}
          </p>
        </div>
      </div>
      <p className={s.disclosure}>
        Illustrative comparison. The listening preview plays the released track;
        a verified original/master pair is not yet available.
      </p>
    </div>
  );
}

function MixInstrument() {
  const [connected, setConnected] = useState(false);
  return (
    <div className={`${s.mixInstrument} ${connected ? s.mixConnected : ""}`}>
      <div className={s.mixTrackA}>
        <div className={s.mixTrackLabel}>
          <span>A / {demoTrack.title}</span>
          <span>122 BPM · F minor</span>
        </div>
        <Waveform />
      </div>
      <div className={s.transitionBridge}>
        <svg
          viewBox="0 0 900 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M0 5H250C390 5 410 95 550 95H900" />
          <path d="M0 95H250C390 95 410 5 550 5H900" />
        </svg>
        <button
          className={s.transitionButton}
          aria-pressed={connected}
          onClick={() => setConnected(!connected)}
        >
          {connected ? "Reset transition" : "Connect the tracks"}
          <span aria-hidden="true">{connected ? "↺" : "↗"}</span>
        </button>
      </div>
      <div className={s.mixTrackB}>
        <Waveform secondary />
        <div className={s.mixTrackLabel}>
          <span>B / Next in the journey</span>
          <span>124 BPM · A♭ major</span>
        </div>
      </div>
      <div className={s.mixFacts} aria-live="polite">
        <div>
          <span>HARMONIC CONTEXT</span>
          <strong>{connected ? "Relative keys" : "Fm → A♭"}</strong>
        </div>
        <div>
          <span>ENERGY FLOW</span>
          <strong>
            {connected ? "Build → Release" : "A shared direction"}
          </strong>
        </div>
        <div>
          <span>TEMPO</span>
          <strong>122 → 124</strong>
        </div>
      </div>
      <p className={s.disclosure}>
        Illustrative track pairing and transition. No rendered mix audio is
        presented.
      </p>
    </div>
  );
}

function PromoInstrument() {
  const [extracted, setExtracted] = useState(false);
  return (
    <div className={`${s.promoInstrument} ${extracted ? s.extracted : ""}`}>
      <div className={s.promoSource}>
        <span className={s.eyebrow}>The music is the starting point</span>
        <Waveform mode="moment" />
        <button
          className={s.extractButton}
          onClick={() => setExtracted(!extracted)}
          aria-expanded={extracted}
          aria-label={
            extracted
              ? "Return to track moment"
              : "Turn the moment into a teaser"
          }
        >
          {extracted ? "Return to the track" : "Extract the moment"}
          <span aria-hidden="true">{extracted ? "↑" : "↓"}</span>
        </button>
      </div>
      <div className={s.promoResult}>
        <div className={s.promoFrame}>
          <Image
            src={demoTrack.artwork}
            alt="Dancing In Color artwork transformed into a vertical teaser concept"
            fill
            sizes="(max-width: 640px) 80vw, 320px"
          />
          <div className={s.promoFrameTop}>
            <span>ATLAS IRWIN</span>
            <span>↗</span>
          </div>
          <div className={s.promoFrameTitle}>
            <span>MOVE WITH IT.</span>
            <strong>
              Baby
              <br />
              Don’t Stop.
            </strong>
            <span>A MOMENT WORTH REPEATING.</span>
          </div>
          <div className={s.promoFrameBottom}>
            <span>TEASER CONCEPT</span>
            <span>01:14 — 01:27</span>
          </div>
        </div>
        <div className={s.promoContext}>
          <span className={s.eyebrow}>
            {extracted ? "From a hook to a story" : "A glimpse of what follows"}
          </span>
          <h3>
            13 seconds.
            <br />
            <em>A way in.</em>
          </h3>
          <dl>
            <div>
              <dt>Moment</dt>
              <dd>01:14 → 01:27</dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>Vertical teaser</dd>
            </div>
            <div>
              <dt>Direction</dt>
              <dd>Build. Then release.</dd>
            </div>
            <div>
              <dt>Next</dt>
              <dd>Clip → Story → Campaign</dd>
            </div>
          </dl>
          <p>
            Let the tension introduce the track. Let the hook make them stay.
          </p>
          <small>Editorial campaign example</small>
        </div>
      </div>
    </div>
  );
}

function Demo() {
  const [tab, setTab] = useState<PillarId>("analysis");
  const audio = useMarketingAudio();
  function selectTab(value: PillarId) {
    setTab(value);
    trackMarketingEvent("demo_tab_viewed", {
      pillar: value,
      demo_track_id: demoTrack.id,
    });
  }
  return (
    <section className={`${s.section} ${s.demoSection}`} id="demo">
      <div className={s.demoHeading}>
        <div>
          <span className={s.eyebrow}>Less explaining. More exploring.</span>
          <h2>
            Meet the <em>instrument.</em>
          </h2>
        </div>
        <p>
          One real track. Four perspectives.
          <br />
          Listen, look closer, follow the possibilities.
        </p>
      </div>
      <div className={s.demoPanel}>
        <div className={s.demoTrackHeader}>
          <Image
            src={demoTrack.artwork}
            alt="Dancing In Color album cover"
            width={64}
            height={64}
          />
          <div>
            <strong>{demoTrack.title}</strong>
            <span>{demoTrack.artist}</span>
          </div>
          <PlayButton />
        </div>
        <div className={s.audioSeek}>
          <span>{audioTime(audio.time)}</span>
          <input
            type="range"
            aria-label="Track playback position"
            min="0"
            max={audio.duration || 1}
            step="0.1"
            value={Math.min(audio.time, audio.duration || 1)}
            disabled={!audio.duration}
            onChange={(event) => audio.seek(Number(event.target.value))}
          />
          <span>{audio.duration ? audioTime(audio.duration) : "—:—"}</span>
        </div>
        {audio.error && (
          <p className={s.audioError} role="alert">
            {audio.error} <button onClick={audio.toggle}>Retry audio</button>
          </p>
        )}
        <div
          className={s.demoTabs}
          role="tablist"
          aria-label="Explore the track"
        >
          {pillars.map((p, index) => (
            <button
              key={p.id}
              id={`tab-${p.id}`}
              role="tab"
              aria-selected={tab === p.id}
              tabIndex={tab === p.id ? 0 : -1}
              aria-controls={`panel-${p.id}`}
              onClick={() => selectTab(p.id)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === "ArrowRight")
                  next = (index + 1) % pillars.length;
                else if (event.key === "ArrowLeft")
                  next = (index + pillars.length - 1) % pillars.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = pillars.length - 1;
                else return;
                event.preventDefault();
                selectTab(pillars[next].id);
                document.getElementById(`tab-${pillars[next].id}`)?.focus();
              }}
            >
              <span>{p.number}</span>
              {p.label}
            </button>
          ))}
        </div>
        <div
          className={s.demoTabPanel}
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          tabIndex={0}
        >
          {tab === "analysis" && (
            <AnalysisInstrument
              progress={audio.duration ? audio.time / audio.duration : 0}
            />
          )}
          {tab === "mastering" && <RefineInstrument />}
          {tab === "mix" && <MixInstrument />}
          {tab === "promote" && <PromoInstrument />}
        </div>
        <div className={s.demoFoot}>
          <span>
            {demoTrack.provenance}. Visuals do not represent a live analysis.
          </span>
          <Link href={ANALYZE_URL}>
            Now bring your music <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

export function MarketingHomepage() {
  return (
    <MarketingShell>
      <main id="marketing-content" className={s.main}>
        <Hero />
        <Intelligence />
        <section
          className={`${s.section} ${s.possibilities}`}
          id="possibilities"
        >
          <span className={s.eyebrow}>The understanding travels with you</span>
          <h2>
            One understanding.
            <br />
            <em>Four ways forward.</em>
          </h2>
          <div className={s.pillarIndex}>
            {pillars.map((p) => (
              <a key={p.id} href={`#${p.id}`}>
                <span>{p.number}</span>
                <strong>{p.label}</strong>
                <Arrow diagonal />
              </a>
            ))}
          </div>
        </section>
        <section
          className={`${s.section} ${s.pillarSection}`}
          id="analysis"
          data-reveal
          data-pillar="analysis"
        >
          <PillarCopy id="analysis" />
          <div className={s.pillarVisual}>
            <div className={s.instrumentHeader}>
              <span className={s.eyebrow}>Track intelligence</span>
              <span className={s.exampleLabel}>ILLUSTRATIVE</span>
            </div>
            <AnalysisInstrument initialMode="moment" />
          </div>
        </section>
        <section
          className={`${s.section} ${s.pillarSection} ${s.refineSection}`}
          id="mastering"
          data-reveal
          data-pillar="mastering"
        >
          <PillarCopy id="mastering" />
          <div className={s.pillarVisual}>
            <RefineInstrument />
          </div>
        </section>
        <section
          className={`${s.section} ${s.mixSection}`}
          id="mix"
          data-reveal
          data-pillar="mix"
        >
          <PillarCopy id="mix" />
          <MixInstrument />
        </section>
        <section
          className={`${s.section} ${s.promoteSection}`}
          id="promote"
          data-reveal
          data-pillar="promote"
        >
          <PillarCopy id="promote" />
          <PromoInstrument />
        </section>
        <section className={s.authorship} id="artists">
          <span className={s.eyebrow}>The part that never changes</span>
          <h2>
            You made
            <br />
            <em>the music.</em>
          </h2>
          <div className={s.authorshipBottom}>
            <EnsemblisMark />
            <p>
              Ensemblis is built around it.
              <br />
              <strong>Not instead of it.</strong>
              <span>
                Its job is to listen, understand and help your work travel
                further.
              </span>
            </p>
          </div>
        </section>
        <section className={`${s.section} ${s.sharedSection}`}>
          <div>
            <span className={s.eyebrow}>Connected by the music</span>
            <h2>
              One understanding.
              <br />
              <em>Everywhere.</em>
            </h2>
            <p>
              Your track’s character shouldn’t get lost between tools. The
              understanding goes with it.
            </p>
          </div>
          <div className={s.channelBus}>
            {pillars.map((p) => (
              <div key={p.id}>
                <span>{p.number}</span>
                <strong>{p.label}</strong>
                <i />
              </div>
            ))}
            <div className={s.busOutput}>
              <EnsemblisMark />
              <span>YOUR MUSIC, FURTHER.</span>
            </div>
          </div>
        </section>
        <Demo />
        <section className={`${s.section} ${s.catalog}`}>
          <span className={s.eyebrow}>
            On the horizon <span className={s.beta}>Coming later</span>
          </span>
          <h2>
            A track tells a story.
            <br />
            <em>A catalog reveals a sound.</em>
          </h2>
          <p>
            Our direction: deeper connections between your releases, recurring
            musical traits and the sound that makes you unmistakably you.
          </p>
          <div className={s.catalogLine}>
            <span>TRACK</span>
            <i />
            <span>RELEASE</span>
            <i />
            <span>CATALOG</span>
            <i />
            <span>YOUR SOUND</span>
          </div>
        </section>
        <section className={`${s.section} ${s.questions}`} id="questions">
          <div>
            <span className={s.eyebrow}>A few things to know</span>
            <h2>
              Before you
              <br />
              <em>press play.</em>
            </h2>
          </div>
          <div>
            {faqs.map((faq) => (
              <details key={faq.question}>
                <summary>
                  {faq.question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
        <FinalCTA />
      </main>
    </MarketingShell>
  );
}

function FinalCTA() {
  return (
    <section className={s.finalCTA}>
      <span className={s.eyebrow}>Start with your music</span>
      <h2>
        Ready to hear
        <br />
        <em>what Ensemblis hears?</em>
      </h2>
      <AnalyzeLink section="final" />
      <span className={s.finalNote}>
        Your next move starts with a closer listen.
      </span>
      <div className={s.finalWave}>
        <Waveform mode="moment" />
      </div>
    </section>
  );
}

export function MarketingProductPage({ page }: { page: string }) {
  const pillar = pillars.find((p) => p.id === page);
  const isAbout = page === "about";
  return (
    <MarketingShell>
      <main id="marketing-content" className={s.main}>
        <section className={`${s.section} ${s.productHero}`}>
          <Link className={s.textLink} href={marketingPath()}>
            ← Ensemblis
          </Link>
          <span className={s.eyebrow}>
            {pillar
              ? `${pillar.number} / ${pillar.label} · Beta`
              : isAbout
                ? "Our approach"
                : "Access & pricing"}
          </span>
          <h1>
            {pillar ? (
              pillar.title
            ) : isAbout ? (
              <>
                You made the music.
                <br />
                <em>We start there.</em>
              </>
            ) : (
              <>
                Start with your music.
                <br />
                <em>Keep your perspective.</em>
              </>
            )}
          </h1>
          <p>
            {pillar
              ? pillar.description
              : isAbout
                ? "Ensemblis is the intelligence layer between making music and everything you want to do with it next. Built for independent artists, producers and DJs who want useful context without handing over their creative decisions."
                : "Ensemblis is currently in private beta. Access requires an existing account. Public plans and self-service signup are not available yet."}
          </p>
          <AnalyzeLink section={page} />
          {page === "pricing" && (
            <span className={s.heroNote}>
              Existing account required · No public pricing announced
            </span>
          )}
        </section>
        {pillar && (
          <>
            <section className={`${s.section} ${s.productVisual}`}>
              {page === "analysis" ? (
                <AnalysisInstrument />
              ) : page === "mastering" ? (
                <RefineInstrument />
              ) : page === "mix" ? (
                <MixInstrument />
              ) : (
                <PromoInstrument />
              )}
            </section>
            <section className={`${s.section} ${s.productDetails}`}>
              {pillar.details.map((detail, index) => (
                <article key={detail.title}>
                  <span className={s.eyebrow}>0{index + 1}</span>
                  <h2>{detail.title}</h2>
                  <p>{detail.text}</p>
                </article>
              ))}
            </section>
            <div className={s.productDemoLink}>
              <Link className={s.textLink} href={marketingPath("#demo")}>
                Listen to the example track
                <Arrow />
              </Link>
            </div>
          </>
        )}
        {!pillar && (
          <section className={`${s.section} ${s.productDetails}`}>
            {(isAbout
              ? [
                  {
                    title: "The artist comes first.",
                    text: "Your music is the starting point. Your judgment is the final word. The system should help you hear, decide and create with more context.",
                  },
                  {
                    title: "Understanding is reusable.",
                    text: "The same track can inform a master, a transition and a release story. One musical understanding connects those decisions.",
                  },
                  {
                    title: "Proof over promises.",
                    text: "We make a clear distinction between product capabilities, illustrative examples and future ideas. Listen, explore and decide for yourself.",
                  },
                ]
              : [
                  {
                    title: "Already have access?",
                    text: "Sign in to your workspace. Analyze a track takes you directly to music import after authentication.",
                  },
                  {
                    title: "Exploring for now?",
                    text: "The homepage example is open to everyone. Listen to a real release and explore the four connected workflows.",
                  },
                  {
                    title: "What will it cost?",
                    text: "Public pricing and packaging have not been announced. Plans and availability will be shared when public access opens.",
                  },
                ]
            ).map((detail) => (
              <article key={detail.title}>
                <h2>{detail.title}</h2>
                <p>{detail.text}</p>
              </article>
            ))}
          </section>
        )}
        <FinalCTA />
      </main>
    </MarketingShell>
  );
}
