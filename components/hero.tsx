"use client";

import { CTAButton } from "@/components/cta-button";

export function Hero() {
  return (
    <section
      id="music"
      className="hero-scene relative min-h-[100svh] overflow-hidden bg-paper"
    >
      <div
        className="relative z-10 flex min-h-[100svh] w-full items-start"
        style={{ minHeight: "inherit" }}
      >
        <div className="hero-copy absolute left-5 top-[9.4rem] flex w-[calc(100%-2.5rem)] max-w-[35rem] flex-col sm:left-[4.25vw] sm:top-[8.8rem] lg:top-[8.85rem] xl:top-[9.05rem]">
          <h1
            className="hero-reveal mt-[2rem] max-w-[4.4ch] origin-left scale-x-[1.14] font-display text-[7.4rem] uppercase leading-[0.82] text-ink sm:text-[9.4rem] md:text-[11rem] lg:text-[12.3rem] xl:text-[13.55rem]"
            style={{ animationDelay: "80ms" }}
          >
            Atlas
            <br />
            Irwin
          </h1>

          <p
            className="hero-reveal max-w-[17rem] font-sans text-[1.08rem] font-extrabold uppercase leading-[1.36] text-ink sm:text-[1.16rem]"
            style={{ animationDelay: "240ms" }}
          >
            <span className="block">Groove driven.</span>
            <span className="block">Systems minded.</span>
            <span className="block">Sound in motion.</span>
          </p>

          <div
            className="hero-reveal mt-[1.85rem] flex flex-wrap items-center gap-x-[2.3rem] gap-y-5 sm:flex-nowrap"
            style={{ animationDelay: "320ms" }}
          >
            <CTAButton href="#contact">Enter the Sound</CTAButton>
            <CTAButton
              href="#release-widget"
              variant="secondary"
              ariaLabel="Listen now"
            >
              Listen Now
            </CTAButton>
          </div>
        </div>
      </div>
    </section>
  );
}
