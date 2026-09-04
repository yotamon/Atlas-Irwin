"use client";

import { CTAButton } from "@/components/cta-button";

type HeroProps = {
  artistName?: string;
  taglines?: string[];
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
};

function splitArtistName(artistName: string) {
  const words = artistName.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [artistName];
  const splitAt = Math.ceil(words.length / 2);
  return [words.slice(0, splitAt).join(" "), words.slice(splitAt).join(" ")];
}

export function Hero({
  artistName = "Atlas Irwin",
  taglines = ["Groove driven.", "Systems minded.", "Sound in motion."],
  primaryCtaLabel = "I want to funk now",
  primaryCtaHref = "#release-widget",
  secondaryCtaLabel = "Contact",
  secondaryCtaHref = "#contact",
}: HeroProps = {}) {
  const artistNameLines = splitArtistName(artistName);

  return (
    <section
      id="music"
      className="hero-scene relative min-h-svh overflow-x-hidden bg-paper box-content pb-35 sm:pb-50"
    >
      <div
        className="relative z-10 flex w-full items-start"
        style={{ minHeight: "inherit" }}
      >
        <div className="hero-copy absolute left-5 top-[9.4rem] flex w-[calc(100%-2.5rem)] max-w-140 flex-col sm:left-[4.25vw] sm:top-[8.8rem] lg:top-[8.85rem] xl:top-[9.05rem]">
          <h1
            className="hero-reveal mt-8 max-w-[4.4ch] origin-left scale-x-[1.14] font-display text-[7.4rem] uppercase leading-[0.82] text-ink sm:text-[9.4rem] md:text-[11rem] lg:text-[12.3rem] xl:text-[13.55rem]"
            style={{ animationDelay: "80ms" }}
          >
            {artistNameLines.map((line, index) => (
              <span key={`${line}-${index}`}>
                {line}
                {index < artistNameLines.length - 1 ? <br /> : null}
              </span>
            ))}
          </h1>

          <p
            className="hero-reveal max-w-68 font-sans text-[1.08rem] font-extrabold uppercase leading-[1.36] text-ink sm:text-[1.16rem]"
            style={{ animationDelay: "240ms" }}
          >
            {taglines.slice(0, 6).map((tagline) => (
              <span className="block" key={tagline}>{tagline}</span>
            ))}
          </p>

          <div
            className="hero-reveal mt-[1.85rem] flex flex-wrap items-center gap-x-[2.3rem] gap-y-5 sm:flex-nowrap"
            style={{ animationDelay: "320ms" }}
          >
            <CTAButton href={primaryCtaHref} ariaLabel={primaryCtaLabel}>
              {primaryCtaLabel}
            </CTAButton>
            <CTAButton href={secondaryCtaHref} variant="secondary">
              {secondaryCtaLabel}
            </CTAButton>
          </div>
        </div>
      </div>
    </section>
  );
}
