const contactChannels = [
  {
    title: "Bookings",
    value: "bookings@atlasirwin.com",
    href: "mailto:bookings@atlasirwin.com",
    note: "Club nights, festivals, support slots, and curatorial bookings.",
  },
  {
    title: "Creative",
    value: "hello@atlasirwin.com",
    href: "mailto:hello@atlasirwin.com",
    note: "Sound design, commissioned visuals, and cross-disciplinary projects.",
  },
  {
    title: "Instagram",
    value: "@atlasirwin",
    href: "https://instagram.com",
    note: "Current work-in-progress, previews, and release updates.",
  },
];

export function ContactSection() {
  return (
    <section
      id="contact"
      className="mx-auto mt-18 w-full max-w-[1320px] px-5 pb-16 sm:px-8 lg:mt-28 lg:px-12 lg:pb-20"
    >
      <div className="grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
        <article className="section-card rounded-[2rem] p-6 sm:p-8 lg:p-10">
          <p className="section-kicker">Contact</p>
          <h2 className="section-title mt-3">Open The Channel</h2>
          <p className="mt-5 max-w-[28rem] text-[1.08rem] leading-8 text-muted">
            For bookings, collaborations, remix requests, and visual commissions,
            reach out directly. The most interesting work usually lives in the
            overlap between sound, motion, and atmosphere.
          </p>

          <div className="paper-inset mt-8 rounded-[1.35rem] px-5 py-5">
            <p className="font-display text-[1.2rem] uppercase tracking-[0.22em] text-teal">
              Current Focus
            </p>
            <p className="mt-3 max-w-[24rem] text-[1rem] leading-7 text-muted">
              2026 DJ bookings, release campaign build-outs, visual systems, and
              soundtrack-oriented commissions.
            </p>
          </div>
        </article>

        <div className="grid gap-4">
          {contactChannels.map((channel) => (
            <a
              key={channel.title}
              href={channel.href}
              target={channel.href.startsWith("http") ? "_blank" : undefined}
              rel={channel.href.startsWith("http") ? "noreferrer" : undefined}
              className="section-card rounded-[1.35rem] px-5 py-5 transition-transform duration-200 hover:-translate-y-0.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-display text-[1.12rem] uppercase tracking-[0.18em] text-teal">
                  {channel.title}
                </p>
                <span className="font-display text-[0.98rem] uppercase tracking-[0.18em] text-muted">
                  Reach out
                </span>
              </div>
              <p className="mt-3 text-[1.2rem] leading-7 text-ink">{channel.value}</p>
              <p className="mt-2 max-w-[31rem] text-[0.98rem] leading-7 text-muted">
                {channel.note}
              </p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
