import Image from "next/image";

import { WaveBackground } from "@/components/wave-background";

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
          <div className="relative min-h-[9rem] overflow-hidden border-b border-line bg-ink sm:min-h-[24rem] lg:min-h-[40rem] lg:border-b-0 lg:border-r">
            <Image
              src="/bio-image.webp"
              alt="Atlas Irwin visual portrait"
              fill
              sizes="(min-width: 1024px) 45vw, 100vw"
              className="object-cover opacity-90 grayscale saturate-75"
              priority={false}
            />
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(180deg, rgba(17,17,17,0.08), rgba(17,17,17,0.68)), radial-gradient(circle at 20% 18%, color-mix(in srgb, var(--accent) 28%, transparent), transparent 30%), radial-gradient(circle at 85% 72%, color-mix(in srgb, var(--teal) 24%, transparent), transparent 34%)",
              }}
            />
          </div>

          <article className="relative p-4 sm:p-8 lg:p-10 xl:p-12">
            <p className="section-kicker">About</p>
            <h2 className="mt-3 max-w-132 font-display text-[2.15rem] uppercase leading-[0.86] tracking-[0.04em] sm:text-[4.4rem] lg:text-[5rem]">
              Retro-Futuristic Electronic Music
            </h2>
            <div className="mt-4 grid gap-3 text-[0.95rem] leading-6 text-muted sm:mt-6 sm:gap-5 sm:text-[1.13rem] sm:leading-8 lg:mt-8 lg:gap-6">
              <p>
                Atlas Irwin is a retro-futuristic electronic music project
                rooted in nu-disco, funk, house, and EDM.
              </p>
              <p>
                The sound blends soulful warmth, polished club energy, and
                luminous electronic texture into tracks built for movement,
                color, and emotional release.
              </p>
              <p>
                Artificial intelligence tools are part of the creative language,
                expanding the palette while human instinct, taste, and direction
                stay at the center.
              </p>
            </div>

            <div className="mt-6 border-t border-line pt-5 sm:mt-8 sm:pt-6 lg:mt-10 lg:pt-7">
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
