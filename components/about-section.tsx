import Image from "next/image";

import { WaveBackground } from "@/components/wave-background";

const principles = [
  {
    label: "01",
    title: "Body Memory",
    text: "Every piece starts with movement: bass weight, pressure, swing, and the small imperfections that make a machine feel touched.",
  },
  {
    label: "02",
    title: "Signal Rituals",
    text: "Fragments, prompts, recordings, and accidents are treated like raw voltage, then shaped until the track begins to breathe on its own.",
  },
  {
    label: "03",
    title: "World Building",
    text: "Sound, artwork, motion, and release language are built as one atmosphere, with each detail tuned to the same internal weather.",
  },
];

const capabilities = [
  "Original productions",
  "Hybrid live/DJ sets",
  "Sound identities",
  "Visual systems",
  "Release worlds",
  "Commissioned work",
];

export function AboutSection() {
  return (
    <section
      id="about"
      className="relative mx-auto mt-18 w-full max-w-330 scroll-mt-26 overflow-hidden px-5 sm:px-8 lg:mt-28 lg:scroll-mt-32 lg:px-12"
    >
      <WaveBackground className="absolute -bottom-8 right-0 z-0 opacity-[0.065]" />

      <div className="relative z-10 overflow-hidden rounded-[1.75rem] border border-line bg-surface shadow-[0_24px_70px_var(--shadow)] backdrop-blur-md sm:rounded-[2.2rem]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent opacity-80" />
        <div className="absolute left-0 top-0 h-full w-px bg-gradient-to-b from-teal via-transparent to-coral opacity-70" />
        <div className="absolute -right-18 top-18 h-58 w-58 rounded-full border border-purple/25 opacity-60" />
        <div className="absolute -bottom-24 left-[42%] h-64 w-64 rounded-full border border-coral/20 opacity-60" />

        <div className="relative grid gap-0 lg:grid-cols-[0.96fr_1.04fr]">
          <div className="relative min-h-[25rem] overflow-hidden border-b border-line bg-ink lg:min-h-[44rem] lg:border-b-0 lg:border-r">
            <Image
              src="/atlas-irwin-avatar.png"
              alt="Atlas Irwin visual portrait"
              fill
              sizes="(min-width: 1024px) 45vw, 100vw"
              className="object-cover opacity-90 grayscale saturate-75"
              priority={false}
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(17,17,17,0.08),rgba(17,17,17,0.68)),radial-gradient(circle_at_20%_18%,rgba(182,255,59,0.28),transparent_30%),radial-gradient(circle_at_85%_72%,rgba(15,169,162,0.24),transparent_34%)]" />
            <div className="absolute inset-x-0 bottom-0 p-6 text-paper sm:p-8 lg:p-10">
              <p className="font-display text-[1rem] uppercase tracking-[0.32em] text-accent">
                Private frequency
              </p>
              <p className="mt-3 max-w-88 text-[1.02rem] leading-7 text-paper/78">
                Warm circuits, club pressure, and hand-finished errors arranged
                into something that still feels lived in.
              </p>
            </div>
          </div>

          <article className="relative p-6 sm:p-8 lg:p-10 xl:p-12">
            <p className="section-kicker">About</p>
            <h2 className="section-title mt-3 max-w-132">Sound With A Shadow</h2>
            <div className="mt-7 grid gap-5 text-[1.08rem] leading-8 text-muted sm:text-[1.13rem]">
              <p>
                Atlas Irwin, also known as Yotam Faraggi, is a producer, DJ, and
                sound designer building groove-driven electronic music where
                club instinct meets visual storytelling.
              </p>
              <p>
                The work moves through an intimate exchange between the body and
                the system: sketches become signals, signals become texture, and
                texture is edited back into something warm enough to feel human.
                Nothing is treated as finished until the pulse, the image, and
                the atmosphere seem to recognize each other.
              </p>
              <p>
                His releases favor tactile bass, elastic percussion, and
                luminous detail, with a process that lets strange sparks enter
                the room while keeping the final hand visible in every decision.
              </p>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {principles.map((principle) => (
                <div
                  key={principle.title}
                  className="border-t border-line pt-4"
                >
                  <span className="font-display text-[1rem] uppercase tracking-[0.24em] text-teal">
                    {principle.label}
                  </span>
                  <h3 className="mt-2 font-display text-[1.62rem] uppercase leading-none tracking-[0.08em] text-ink">
                    {principle.title}
                  </h3>
                  <p className="mt-3 text-[0.95rem] leading-6 text-muted">
                    {principle.text}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-9 border-t border-line pt-6">
              <h3 className="font-display text-[1.2rem] uppercase tracking-[0.22em] text-purple">
                Available For
              </h3>
              <div className="mt-4 flex flex-wrap gap-2.5">
                {capabilities.map((capability) => (
                  <span
                    key={capability}
                    className="rounded-full border border-line bg-surface-soft px-3.5 py-2 font-display text-[0.96rem] uppercase tracking-[0.14em] text-ink"
                  >
                    {capability}
                  </span>
                ))}
              </div>
            </div>
          </article>
        </div>

        <div className="grid border-t border-line text-ink sm:grid-cols-3">
          <p className="border-b border-line px-6 py-4 font-display text-[1.02rem] uppercase tracking-[0.18em] sm:border-b-0 sm:border-r sm:px-8">
            Groove-led
          </p>
          <p className="border-b border-line px-6 py-4 font-display text-[1.02rem] uppercase tracking-[0.18em] sm:border-b-0 sm:border-r sm:px-8">
            Signal-shaped
          </p>
          <p className="px-6 py-4 font-display text-[1.02rem] uppercase tracking-[0.18em] sm:px-8">
            Human-finished
          </p>
        </div>
      </div>
    </section>
  );
}
