import { ContactForm } from "@/components/contact-form";

type ContactSectionProps = {
  email?: string | null;
  heading?: string;
  copy?: string;
  formEnabled?: boolean;
  formEndpoint?: string;
  formContext?: Record<string, string>;
};

export function ContactSection({
  email = "atlas.irwin.music@gmail.com",
  heading = "Let's Talk",
  copy = "For bookings, collaborations, remix requests, and commissioned work, send a short note. Direct email works too.",
  formEnabled = true,
  formEndpoint = "/api/contact",
  formContext = {},
}: ContactSectionProps = {}) {
  if (!email && !formEnabled) return null;

  return (
    <section
      id="contact"
      className="mx-auto mt-18 w-full max-w-295 scroll-mt-32 px-5 pb-16 sm:px-8 lg:mt-28 lg:px-12 lg:pb-20"
    >
      <div className={`grid gap-6 ${formEnabled ? "lg:grid-cols-[0.78fr_1fr]" : "lg:grid-cols-1"} lg:items-start`}>
        <div className="py-2 lg:py-8">
          <p className="section-kicker">Contact</p>
          <h2 className="section-title mt-3">{heading}</h2>
          <p className="mt-5 max-w-116 text-[1.08rem] leading-8 text-muted">
            {copy}
          </p>
          {email ? (
            <a
              href={`mailto:${email}`}
              className="mt-7 inline-flex font-display text-[1.15rem] uppercase tracking-[0.18em] text-teal transition-colors duration-200 hover:text-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
            >
              {email}
            </a>
          ) : null}
        </div>

        {formEnabled ? <ContactForm endpoint={formEndpoint} context={formContext} /> : null}
      </div>
    </section>
  );
}
