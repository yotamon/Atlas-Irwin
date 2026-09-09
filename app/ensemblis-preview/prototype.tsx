"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import styles from "./prototype.module.css";

type AnalysisMode = "structure" | "energy" | "moments";

const waveform = [
  28, 36, 44, 32, 52, 66, 40, 58, 72, 48, 62, 78, 54, 46, 68, 82, 56, 74,
  88, 64, 52, 76, 92, 70, 58, 84, 96, 76, 68, 90, 80, 62, 72, 86, 66, 54,
  74, 82, 60, 48, 64, 72, 52, 40, 58, 48, 34, 26,
];

const analysisCopy: Record<AnalysisMode, { label: string; value: string; note: string }> = {
  structure: {
    label: "Structure resolved",
    value: "Intro · Build · Drop · Break · Final",
    note: "The track becomes a map instead of a file.",
  },
  energy: {
    label: "Energy contour",
    value: "Peak movement · 01:14 → 01:27",
    note: "The system understands where tension rises and releases.",
  },
  moments: {
    label: "Strongest moment",
    value: "01:14 → 01:27 · confidence 0.92",
    note: "A musical insight can become a mix decision or a campaign asset.",
  },
};

function Waveform({ mode = "structure", compact = false }: { mode?: AnalysisMode; compact?: boolean }) {
  return (
    <div className={`${styles.waveform} ${compact ? styles.waveformCompact : ""}`} aria-hidden="true">
      {waveform.map((height, index) => {
        const inStrongMoment = index >= 27 && index <= 34;
        const energyBoost = mode === "energy" ? Math.min(100, height + index * 0.55) : height;
        return (
          <span
            key={`${height}-${index}`}
            className={`${styles.waveBar} ${mode === "moments" && inStrongMoment ? styles.waveBarMoment : ""}`}
            style={
              {
                "--bar-height": `${energyBoost}%`,
                "--bar-delay": `${index * 14}ms`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

function SectionLabel({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <div className={styles.sectionLabel}>
      <span>{index}</span>
      <span>{children}</span>
    </div>
  );
}

export function EnsemblisMarketingPrototype() {
  const reduceMotion = Boolean(useReducedMotion());
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("structure");
  const [mixRun, setMixRun] = useState(0);
  const [promoRun, setPromoRun] = useState(0);

  const motionDuration = reduceMotion ? 0 : 0.8;

  return (
    <div className={styles.prototype}>
      <nav className={styles.nav} aria-label="Prototype navigation">
        <a className={styles.brand} href="#top" aria-label="Ensemblis prototype home">
          <span className={styles.mark} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>ENSEMBLIS</span>
        </a>
        <div className={styles.navMeta}>
          <span>Marketing prototype</span>
          <span className={styles.conceptBadge}>CONCEPT FIXTURE</span>
        </div>
      </nav>

      <section className={styles.hero} id="top">
        <div className={styles.heroCopy}>
          <motion.p
            className={styles.eyebrow}
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: motionDuration }}
          >
            Deep music intelligence for artists, producers and DJs
          </motion.p>
          <motion.h1
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: motionDuration, delay: reduceMotion ? 0 : 0.08 }}
          >
            Your music.
            <em>Understood.</em>
          </motion.h1>
          <motion.p
            className={styles.heroBody}
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: motionDuration, delay: reduceMotion ? 0 : 0.16 }}
          >
            One musical understanding that can refine a master, connect a set and turn the right moment into promotion.
          </motion.p>
          <div className={styles.heroActions}>
            <a className={styles.primaryButton} href="#signature-moments">Analyze a track</a>
            <a className={styles.textLink} href="#signature-moments">See the signature moments ↓</a>
          </div>
        </div>

        <motion.div
          className={styles.heroSignal}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : 1.1, delay: reduceMotion ? 0 : 0.15 }}
        >
          <div className={styles.trackHeader}>
            <div>
              <span className={styles.trackKicker}>DEMO TRACK · CONCEPT DATA</span>
              <strong>Night Signal</strong>
            </div>
            <span>03:42</span>
          </div>

          <div className={styles.heroWaveWrap}>
            <Waveform mode="moments" />
            {!reduceMotion && (
              <motion.div
                className={styles.scanLine}
                initial={{ left: "-8%" }}
                animate={{ left: ["-8%", "108%", "108%"] }}
                transition={{ duration: 5.5, times: [0, 0.58, 1], repeat: Infinity, repeatDelay: 1.4, ease: "easeInOut" }}
              />
            )}
            <div className={styles.strongMomentMarker}>
              <span>strongest moment</span>
              <b>01:14</b>
            </div>
          </div>

          <div className={styles.metricRow}>
            <div><span>BPM</span><strong>122</strong></div>
            <div><span>KEY</span><strong>F minor</strong></div>
            <div><span>ENERGY</span><strong>Rising</strong></div>
            <div><span>CHARACTER</span><strong>Warm · Hypnotic</strong></div>
          </div>

          <div className={styles.pillarRail}>
            <span>UNDERSTAND</span>
            <span>REFINE</span>
            <span>MIX &amp; PERFORM</span>
            <span>PROMOTE</span>
          </div>
        </motion.div>
      </section>

      <main id="signature-moments">
        <section className={styles.signatureSection} id="understand">
          <div className={styles.sectionCopy}>
            <SectionLabel index="01">SIGNAL → MEANING</SectionLabel>
            <h2>One waveform.<br /><em>Different truths.</em></h2>
            <p>
              Instead of filling the screen with dashboard cards, the same musical object changes semantic mode. The visitor sees Ensemblis discover structure, energy and meaningful moments.
            </p>
            <div className={styles.modeTabs} role="tablist" aria-label="Analysis visualization mode">
              {(["structure", "energy", "moments"] as AnalysisMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={analysisMode === mode}
                  className={analysisMode === mode ? styles.modeTabActive : styles.modeTab}
                  onClick={() => setAnalysisMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.analysisStage}>
            <div className={styles.analysisTopline}>
              <span>Listening model</span>
              <span>Night Signal · 03:42</span>
            </div>
            <div className={styles.analysisWaveShell}>
              <Waveform mode={analysisMode} />
              <AnimatePresence mode="wait">
                <motion.div
                  key={analysisMode}
                  className={`${styles.semanticOverlay} ${styles[`semantic${analysisMode[0].toUpperCase()}${analysisMode.slice(1)}`]}`}
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: reduceMotion ? 0 : 0.35 }}
                >
                  {analysisMode === "structure" && (
                    <div className={styles.structureBands}>
                      <span>INTRO</span><span>BUILD</span><span>DROP</span><span>BREAK</span><span>FINAL</span>
                    </div>
                  )}
                  {analysisMode === "energy" && <div className={styles.energyCurve} />}
                  {analysisMode === "moments" && <div className={styles.momentWindow}>01:14 → 01:27</div>}
                </motion.div>
              </AnimatePresence>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={analysisMode}
                className={styles.analysisResult}
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: reduceMotion ? 0 : 0.3 }}
              >
                <span>{analysisCopy[analysisMode].label}</span>
                <strong>{analysisCopy[analysisMode].value}</strong>
                <p>{analysisCopy[analysisMode].note}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </section>

        <section className={`${styles.signatureSection} ${styles.mixSection}`} id="mix">
          <div className={styles.sectionCopy}>
            <SectionLabel index="02">CONNECT → FLOW</SectionLabel>
            <h2>Make the transition<br /><em>explain itself.</em></h2>
            <p>
              Track compatibility should feel musical, not spreadsheet-like. Two identities enter, the relationship resolves, and the transition window becomes visible.
            </p>
            <button className={styles.secondaryButton} type="button" onClick={() => setMixRun((run) => run + 1)}>
              Replay transition motion
            </button>
            <span className={styles.prototypeNote}>Visual prototype only · no audio playback yet</span>
          </div>

          <div className={styles.mixStage}>
            <div className={`${styles.trackLane} ${styles.trackLaneA}`}>
              <span className={styles.trackLetter}>A</span>
              <div>
                <strong>Night Signal</strong>
                <span>122 BPM · F minor</span>
              </div>
              <Waveform mode="energy" compact />
            </div>

            <div className={styles.transitionField}>
              <div className={styles.transitionLabel}>SUGGESTED TRANSITION · 02:41 → 00:32</div>
              <div className={styles.transitionLines}>
                <motion.span
                  key={`a-${mixRun}`}
                  className={styles.transitionA}
                  initial={reduceMotion ? false : { scaleX: 0.25, opacity: 0.3 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{ duration: reduceMotion ? 0 : 1.25, ease: [0.22, 1, 0.36, 1] }}
                />
                <motion.span
                  key={`b-${mixRun}`}
                  className={styles.transitionB}
                  initial={reduceMotion ? false : { scaleX: 0.25, opacity: 0.3 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{ duration: reduceMotion ? 0 : 1.25, delay: reduceMotion ? 0 : 0.14, ease: [0.22, 1, 0.36, 1] }}
                />
                {!reduceMotion && (
                  <motion.i
                    key={`play-${mixRun}`}
                    className={styles.transitionPlayhead}
                    initial={{ left: "8%" }}
                    animate={{ left: "92%" }}
                    transition={{ duration: 2.2, ease: "easeInOut" }}
                  />
                )}
              </div>
              <div className={styles.compatibilityRow}>
                <span><i /> Harmonic match <b>✓</b></span>
                <span><i /> Energy flow <b>✓</b></span>
                <span><i /> Tempo fit <b>✓</b></span>
                <strong>91%</strong>
              </div>
            </div>

            <div className={`${styles.trackLane} ${styles.trackLaneB}`}>
              <span className={styles.trackLetter}>B</span>
              <div>
                <strong>Soft Circuit</strong>
                <span>123 BPM · A♭ major</span>
              </div>
              <Waveform mode="structure" compact />
            </div>
          </div>
        </section>

        <section className={`${styles.signatureSection} ${styles.promoteSection}`} id="promote">
          <div className={styles.sectionCopy}>
            <SectionLabel index="03">EXTRACT → TRANSFORM</SectionLabel>
            <h2>Your track already<br /><em>contains the campaign.</em></h2>
            <p>
              The promotional asset should visibly originate inside the music. Ensemblis finds the moment first, then turns that musical understanding into creative direction.
            </p>
            <button className={styles.secondaryButton} type="button" onClick={() => setPromoRun((run) => run + 1)}>
              Extract strongest moment
            </button>
          </div>

          <div className={styles.promoStage}>
            <div className={styles.promoSource}>
              <div className={styles.promoSourceHeader}>
                <span>STRONG MOMENT FOUND</span>
                <strong>01:14 → 01:27</strong>
              </div>
              <div className={styles.promoWaveWrap}>
                <Waveform mode="moments" />
                <motion.div
                  key={`slice-${promoRun}`}
                  className={styles.extractSlice}
                  initial={reduceMotion ? false : { opacity: 0, scaleY: 0.6 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  transition={{ duration: reduceMotion ? 0 : 0.55 }}
                >
                  13 SEC
                </motion.div>
              </div>
              <motion.div
                key={`insight-${promoRun}`}
                className={styles.musicInsight}
                initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.45, delay: reduceMotion ? 0 : 0.35 }}
              >
                <span>The strongest emotional shift starts eight seconds before the drop.</span>
              </motion.div>
            </div>

            <motion.div
              key={`creative-${promoRun}`}
              className={styles.creativeCard}
              initial={reduceMotion ? false : { opacity: 0.35, x: 34, rotate: 2 }}
              animate={{ opacity: 1, x: 0, rotate: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.75, delay: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className={styles.creativeVisual}>
                <span className={styles.creativePulse} />
                <span className={styles.creativeTitle}>NIGHT<br />SIGNAL</span>
                <span className={styles.creativeMeta}>OUT FRIDAY · 00:13</span>
              </div>
              <div className={styles.creativeContext}>
                <div><span>USE</span><strong>First teaser</strong></div>
                <div><span>PLATFORM</span><strong>Reels / TikTok</strong></div>
                <div><span>MOOD</span><strong>Euphoric tension</strong></div>
                <div><span>TIMING</span><strong>T−10</strong></div>
              </div>
            </motion.div>
          </div>
        </section>

        <section className={styles.paperSection}>
          <SectionLabel index="04">THE HUMAN CENTER</SectionLabel>
          <div className={styles.paperCopy}>
            <h2>You made<br /><em>the music.</em></h2>
            <p>
              Ensemblis is built around it. Not instead of it. Its job is to listen, understand and help your work travel further.
            </p>
          </div>
          <div className={styles.paperSignal} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div>
          <span className={styles.footerEyebrow}>VISUAL PROTOTYPE · INTERNAL</span>
          <h2>Ready to hear<br /><em>what Ensemblis hears?</em></h2>
        </div>
        <a className={styles.primaryButton} href="#top">Replay from the top ↑</a>
      </footer>
    </div>
  );
}
