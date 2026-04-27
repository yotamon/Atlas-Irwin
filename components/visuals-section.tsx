import Image from "next/image";

const visualSystems = [
  {
    number: "01",
    title: "Poster Language",
    text: "Oversized type, tactile grain, and psychedelic color movement translated across release campaigns and one-off artwork.",
  },
  {
    number: "02",
    title: "Motion Fragments",
    text: "Loops, teaser edits, and reactive screen visuals designed to feel rhythmic rather than over-produced.",
  },
  {
    number: "03",
    title: "Identity Assets",
    text: "A system of covers, textures, marks, and crops that keeps every drop connected without feeling repetitive.",
  },
];

const outputs = [
  "Cover art",
  "Teaser loops",
  "Tour visuals",
  "Animated crops",
  "Poster sets",
  "Visual systems",
];

export function VisualsSection() {
  return (
    <section
      id="visuals"
      className="mx-auto mt-18 w-full max-w-[1320px] px-5 sm:px-8 lg:mt-28 lg:px-12"
    >
      <div className="grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
        <article className="section-card rounded-[2rem] p-6 sm:p-8 lg:p-10">
          <p className="section-kicker">Visuals</p>
          <h2 className="section-title mt-3">Built Like A World</h2>
          <p className="mt-5 max-w-[28rem] text-[1.06rem] leading-8 text-muted">
            The Atlas Irwin visual identity is designed like the music itself:
            expressive on first contact, but structured underneath. Posters,
            release art, motion fragments, and stage-ready crops all pull from
            the same tactile palette.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {outputs.map((output) => (
              <span
                key={output}
                className="paper-inset rounded-full px-4 py-2 font-display text-[1.05rem] uppercase tracking-[0.16em]"
              >
                {output}
              </span>
            ))}
          </div>
        </article>

        <article className="section-card rounded-[2rem] p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="paper-inset overflow-hidden rounded-[1.55rem] p-3">
              <Image
                src="/atlas-cover.png"
                alt="Funkable EP cover art"
                width={420}
                height={420}
                unoptimized
                className="h-full w-full rounded-[1.1rem] object-cover"
              />
            </div>

            <div className="grid gap-4">
              <div className="paper-inset overflow-hidden rounded-[1.55rem] p-4">
                <Image
                  src="/atlas-irwin-logo-text-transparent.png"
                  alt="Atlas Irwin wordmark"
                  width={1080}
                  height={185}
                  unoptimized
                  className="theme-logo h-auto w-full"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="paper-inset overflow-hidden rounded-[1.35rem] p-2">
                  <Image
                    src="/light-bg.png"
                    alt="Light theme texture sample"
                    width={1536}
                    height={1024}
                    unoptimized
                    className="h-full min-h-[10rem] w-full rounded-[1rem] object-cover"
                  />
                </div>
                <div className="paper-inset overflow-hidden rounded-[1.35rem] p-2">
                  <Image
                    src="/dark-bg.png"
                    alt="Dark theme texture sample"
                    width={1536}
                    height={1024}
                    unoptimized
                    className="h-full min-h-[10rem] w-full rounded-[1rem] object-cover"
                  />
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {visualSystems.map((item) => (
          <article key={item.number} className="section-card rounded-[1.6rem] p-5 sm:p-6">
            <p className="font-display text-[1.3rem] uppercase tracking-[0.24em] text-teal">
              {item.number}
            </p>
            <h3 className="mt-4 font-display text-[2.15rem] uppercase tracking-[0.08em]">
              {item.title}
            </h3>
            <p className="mt-3 max-w-[20rem] text-[1rem] leading-7 text-muted">
              {item.text}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
