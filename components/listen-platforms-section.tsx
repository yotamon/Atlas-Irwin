import { BiLogoSoundcloud, BiLogoSpotify, BiLogoYoutube } from "react-icons/bi";
import { BsAppleMusic } from "react-icons/bs";
import { FaDeezer } from "react-icons/fa";

const platformLinks = [
  {
    label: "SoundCloud",
    href: "https://soundcloud.com/atlas-irwin",
    icon: BiLogoSoundcloud,
  },
  {
    label: "Spotify",
    href: "https://open.spotify.com/artist/5BHcMdmbmxYwIFzqZvE3pc?si=a7EU_3TdQYSjGRAcvnJ8pg",
    icon: BiLogoSpotify,
  },
  {
    label: "Deezer",
    href: "https://www.deezer.com/en/artist/386920031",
    icon: FaDeezer,
  },
  {
    label: "Apple Music",
    href: "https://music.apple.com/us/artist/atlas-irwin/1895148790",
    icon: BsAppleMusic,
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/@AtlasIrwin",
    icon: BiLogoYoutube,
  },
];

export function ListenPlatformsSection() {
  return (
    <section
      id="platforms"
      className="mx-auto mt-12 w-full max-w-[1320px] px-5 sm:px-8 lg:mt-18 lg:px-12"
    >
      <div className="flex flex-col items-center text-center">
        <h2 className="font-display text-[3rem] uppercase leading-[0.9] tracking-[0.06em] sm:text-[4rem] lg:text-[4.5rem]">
          Listen At All Platforms
        </h2>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          {platformLinks.map(({ label, href, icon: Icon }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer"
              aria-label={label}
              title={label}
              className="group inline-flex h-15 w-15 items-center justify-center rounded-full border border-line/80 bg-surface-soft/55 text-ink transition-all duration-200 hover:-translate-y-0.5 hover:border-teal hover:bg-surface-soft hover:text-teal sm:h-16 sm:w-16"
            >
              <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
