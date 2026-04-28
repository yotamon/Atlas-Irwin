import { WaveBackground } from "@/components/wave-background";

const principles = [
  {
    title: "Groove First",
    text: "Every production starts from movement. Rhythm is the anchor, even when the sound design gets strange.",
  },
  {
    title: "Systems Minded",
    text: "Tracks, artwork, and live presentation are built as one connected language rather than separate deliverables.",
  },
  {
    title: "Human Texture",
    text: "Imperfection is part of the identity: grain, pressure, and warmth keep the work from feeling sterile.",
  },
];

const capabilities = [
  "DJ sets",
  "Original production",
  "Sound design",
  "Visual direction",
  "Release rollouts",
  "Creative consulting",
];

export function AboutSection() {
  return (
    <section
      id="about"
      className="relative mx-auto mt-18 w-full max-w-330 overflow-hidden px-5 sm:px-8 lg:mt-28 lg:px-12"
    >
      <WaveBackground className="absolute bottom-0 right-0 z-0 opacity-[0.07]" />

      <div className="relative z-10 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <article className="section-card rounded-4xl p-6 sm:p-8 lg:p-10">
          <p className="section-kicker">About</p>
          <h2 className="section-title mt-3">Sound In Motion</h2>
          <p className="mt-5 max-w-124 text-[1.08rem] leading-8 text-muted">
            Atlas Irwin is a producer, DJ, and sound designer creating work that
            sits between club utility and visual storytelling. The palette leans
            warm, tactile, and groove-driven, while the structure stays precise
            enough to travel across releases, stage moments, and commissioned
            work.
          </p>
          <p className="mt-5 max-w-124 text-[1.08rem] leading-8 text-muted">
            The goal is always the same: build a complete atmosphere that hits
            fast but holds up on repeat listens. Music, artwork, motion, and
            identity all move together.
          </p>
        </article>

        <div className="grid gap-6">
          <article className="section-card rounded-4xl p-6 sm:p-8">
            <h3 className="font-display text-[2.35rem] uppercase tracking-[0.08em]">
              Working Principles
            </h3>
            <div className="mt-6 grid gap-4">
              {principles.map((principle) => (
                <div
                  key={principle.title}
                  className="paper-inset rounded-[1.15rem] px-4 py-4"
                >
                  <h4 className="font-display text-[1.55rem] uppercase tracking-[0.12em] text-ink">
                    {principle.title}
                  </h4>
                  <p className="mt-2 max-w-lg text-[1rem] leading-7 text-muted">
                    {principle.text}
                  </p>
                </div>
              ))}
            </div>
          </article>

          <article className="section-card rounded-4xl p-6 sm:p-8">
            <h3 className="font-display text-[2.35rem] uppercase tracking-[0.08em]">
              Available For
            </h3>
            <div className="mt-5 flex flex-wrap gap-3">
              {capabilities.map((capability) => (
                <span
                  key={capability}
                  className="paper-inset rounded-full px-4 py-2 font-display text-[1.08rem] uppercase tracking-[0.16em]"
                >
                  {capability}
                </span>
              ))}
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
