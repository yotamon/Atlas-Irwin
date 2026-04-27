"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties } from "react";

import { CTAButton } from "@/components/cta-button";
import { StarMarkIcon, WaveStampIcon } from "@/components/icons";
import { WaveBackground } from "@/components/wave-background";

export function Hero() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section
      id="music"
      className="relative flex flex-1 items-stretch overflow-hidden pt-[10.6rem] pb-12 md:pt-[7.7rem] md:pb-14 lg:pb-26"
    >
      <div className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-1 px-5 sm:px-8 lg:grid-cols-[minmax(22rem,30rem)_1fr] lg:px-12 xl:grid-cols-[31rem_1fr]">
        <div className="relative z-20 flex flex-col justify-start pt-10 pb-8 sm:pt-12 sm:pb-10 lg:pt-[8vh]">
          <StarMarkIcon
            className="hero-reveal mb-6 h-7 w-7 text-[#ef6f9f] sm:mb-8 sm:h-8 sm:w-8"
            style={{ animationDelay: "60ms" } as CSSProperties}
          />
          <h1
            className="hero-reveal max-w-[4.3ch] font-display text-[6.25rem] uppercase leading-[0.8] tracking-[0.02em] text-ink sm:text-[8.4rem] md:text-[10.1rem] xl:text-[11.2rem]"
            style={{ animationDelay: "80ms" }}
          >
            Atlas
            <br />
            Irwin
          </h1>

          <div
            className="hero-reveal mt-5 text-ink/88 sm:mt-6"
            style={{ animationDelay: "160ms" }}
          >
            <WaveStampIcon className="h-10 w-[16rem] sm:w-[18rem]" />
          </div>

          <div
            className="hero-reveal mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.9rem] uppercase tracking-[0.34em] text-ink/80 sm:mt-6 sm:text-[1rem] lg:text-[1.05rem]"
            style={{ animationDelay: "240ms" }}
          >
            <span>Producer</span>
            <span className="text-coral">•</span>
            <span>DJ</span>
            <span className="text-coral">•</span>
            <span>Sound Design</span>
          </div>

          <p
            className="hero-reveal mt-6 max-w-[18rem] border-t border-ink/68 pt-6 font-display text-[1.95rem] uppercase leading-[1.12] tracking-[0.11em] text-ink/90 sm:mt-7 sm:max-w-[19rem] sm:text-[2.15rem] lg:text-[2.32rem]"
            style={{ animationDelay: "320ms" }}
          >
            <span className="block">Groove driven.</span>
            <span className="block">Systems minded.</span>
            <span className="block">Sound in motion.</span>
          </p>

          <div
            className="hero-reveal mt-10 flex flex-wrap items-end gap-x-5 gap-y-6 sm:mt-12 sm:gap-x-7"
            style={{ animationDelay: "400ms" }}
          >
            <CTAButton href="#contact">Enter the Sound</CTAButton>
            <CTAButton href="#release-widget" variant="secondary" ariaLabel="Listen now">
              <>
                Listen
                <br />
                Now
              </>
            </CTAButton>
          </div>

          <div className="relative mt-12 h-[16rem] sm:h-[19rem] lg:hidden">
            <WaveBackground className="bottom-[-1.5rem] left-[-3rem] w-[155%] min-w-0 max-w-none" />
            <div className="absolute bottom-[-2rem] right-[-0.6rem] h-[16rem] w-[13rem] sm:bottom-[-2.4rem] sm:h-[18rem] sm:w-[15rem]">
              <Image
                src="/atlas-illustration.png"
                alt="Psychedelic portrait artwork for Atlas Irwin"
                width={664}
                height={1183}
                priority
                loading="eager"
                unoptimized
                className="h-full w-full select-none object-contain object-top mix-blend-multiply"
              />
            </div>
          </div>
        </div>

        <div className="relative hidden min-h-[clamp(40rem,63vw,56rem)] lg:block">

          <div className="absolute left-[16%] top-[22%] h-28 w-28 rounded-full bg-[radial-gradient(circle,_rgba(242,111,159,0.24),_transparent_70%)] blur-2xl" />
          <div className="absolute left-[34%] top-[26%] h-36 w-36 rounded-full bg-[radial-gradient(circle,_rgba(255,202,70,0.2),_transparent_70%)] blur-3xl" />
          <div className="absolute right-[10%] top-[14%] h-44 w-44 rounded-full bg-[radial-gradient(circle,_rgba(182,255,59,0.18),_transparent_68%)] blur-3xl" />
          <div className="absolute right-[24%] top-[19%] h-52 w-52 rounded-full bg-[radial-gradient(circle,_rgba(15,169,162,0.12),_transparent_72%)] blur-3xl" />

          <div className="absolute bottom-[-13rem] right-[-7rem] top-[-0.75rem] w-[min(52rem,59vw)] xl:right-[-5rem] xl:w-[min(56rem,60vw)] 2xl:right-[-2rem]">
            <motion.div
              animate={
                shouldReduceMotion
                  ? undefined
                  : {
                      y: [0, -12, 0],
                      rotate: [0, -0.7, 0.15, 0],
                    }
              }
              transition={{
                duration: 12,
                repeat: Number.POSITIVE_INFINITY,
                repeatType: "mirror",
                ease: "easeInOut",
              }}
              className="relative h-full w-full"
            >
              <Image
                src="/atlas-illustration.png"
                alt="Psychedelic portrait artwork for Atlas Irwin"
                width={664}
                height={1183}
                priority
                loading="eager"
                unoptimized
                className="h-full w-full select-none object-contain object-top mix-blend-multiply"
              />
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
