import type { IconType } from "react-icons";
import { BiLogoSoundcloud, BiLogoSpotify, BiLogoYoutube } from "react-icons/bi";
import { BsAppleMusic } from "react-icons/bs";
import { FaDeezer, FaExternalLinkAlt } from "react-icons/fa";

export type ListeningPlatformLink = {
  label: string;
  href: string;
  provider?: string;
};

type ListenPlatformsSectionProps = {
  heading?: string;
  links?: ListeningPlatformLink[];
};

const defaultPlatformLinks: ListeningPlatformLink[] = [
  {
    label: "SoundCloud",
    href: "https://soundcloud.com/atlas-irwin",
    provider: "soundcloud",
  },
  {
    label: "Spotify",
    href: "https://open.spotify.com/artist/5BHcMdmbmxYwIFzqZvE3pc?si=a7EU_3TdQYSjGRAcvnJ8pg",
    provider: "spotify",
  },
  {
    label: "Deezer",
    href: "https://www.deezer.com/en/artist/386920031",
    provider: "deezer",
  },
  {
    label: "Apple Music",
    href: "https://music.apple.com/us/artist/atlas-irwin/1895148790",
    provider: "apple-music",
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/@AtlasIrwin",
    provider: "youtube",
  },
];

function iconForPlatform(link: ListeningPlatformLink): IconType {
  const provider = (link.provider || link.label).toLowerCase().replaceAll(" ", "-");
  if (provider.includes("soundcloud")) return BiLogoSoundcloud;
  if (provider.includes("spotify")) return BiLogoSpotify;
  if (provider.includes("deezer")) return FaDeezer;
  if (provider.includes("apple")) return BsAppleMusic;
  if (provider.includes("youtube")) return BiLogoYoutube;
  return FaExternalLinkAlt;
}

export function ListenPlatformsSection({
  heading = "Listen Everywhere",
  links = defaultPlatformLinks,
}: ListenPlatformsSectionProps = {}) {
  if (!links.length) return null;

  return (
    <section
      id="platforms"
      className="mx-auto mt-12 w-full max-w-330 px-5 sm:px-8 lg:mt-18 lg:px-12"
    >
      <div className="flex flex-col items-center text-center">
        <h2 className="font-display text-[3rem] uppercase leading-[0.9] tracking-[0.06em] sm:text-[4rem] lg:text-[4.5rem]">
          {heading}
        </h2>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-6 sm:gap-8">
          {links.map((link) => {
            const Icon = iconForPlatform(link);
            return (
              <a
                key={`${link.label}-${link.href}`}
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={link.label}
                title={link.label}
                className="group inline-flex flex-col items-center gap-3 text-ink transition-all duration-200 hover:-translate-y-0.5 hover:text-teal"
              >
                <span className="inline-flex h-15 w-15 items-center justify-center rounded-full border border-line/80 bg-surface-soft/55 transition-all duration-200 group-hover:scale-105 group-hover:border-teal group-hover:bg-surface-soft group-hover:text-teal group-hover:shadow-md sm:h-16 sm:w-16">
                  <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
                </span>
                <span className="inline-flex items-center font-display text-[0.75rem] uppercase tracking-[0.18em] text-muted transition-colors duration-200 group-hover:text-teal">
                  {link.label}
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
