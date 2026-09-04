import type { IconType } from "react-icons";
import { BiLogoSoundcloud, BiLogoSpotify, BiLogoYoutube } from "react-icons/bi";
import { BsAppleMusic } from "react-icons/bs";
import { FaDeezer, FaExternalLinkAlt } from "react-icons/fa";

import { ThemeToggle } from "@/components/theme-toggle";

type FooterSocialLink = {
  href: string;
  label: string;
  provider?: string;
};

type FooterProps = {
  artistName?: string;
  socialLinks?: FooterSocialLink[];
};

const defaultSocials: FooterSocialLink[] = [
  {
    href: "https://soundcloud.com/atlas-irwin",
    label: "SoundCloud",
    provider: "soundcloud",
  },
  {
    href: "https://open.spotify.com/artist/5BHcMdmbmxYwIFzqZvE3pc?si=a7EU_3TdQYSjGRAcvnJ8pg",
    label: "Spotify",
    provider: "spotify",
  },
  {
    href: "https://www.deezer.com/en/artist/386920031",
    label: "Deezer",
    provider: "deezer",
  },
  {
    href: "https://music.apple.com/us/artist/atlas-irwin/1895148790",
    label: "Apple Music",
    provider: "apple-music",
  },
  {
    href: "https://www.youtube.com/@AtlasIrwin",
    label: "YouTube",
    provider: "youtube",
  },
];

function iconForSocial(link: FooterSocialLink): IconType {
  const provider = (link.provider || link.label).toLowerCase().replaceAll(" ", "-");
  if (provider.includes("soundcloud")) return BiLogoSoundcloud;
  if (provider.includes("spotify")) return BiLogoSpotify;
  if (provider.includes("deezer")) return FaDeezer;
  if (provider.includes("apple")) return BsAppleMusic;
  if (provider.includes("youtube")) return BiLogoYoutube;
  return FaExternalLinkAlt;
}

export function Footer({
  artistName = "Atlas Irwin",
  socialLinks = defaultSocials,
}: FooterProps = {}) {
  return (
    <footer className="border-t border-line/70 bg-paper/90">
      <div className="mx-auto grid w-full max-w-400 grid-cols-1 items-end gap-5 px-5 pb-4 pt-5 sm:px-8 md:grid-cols-2 lg:px-12">
        <div className="flex items-center gap-4 md:justify-self-start">
          {socialLinks.map((link) => {
            const Icon = iconForSocial(link);
            return (
              <a
                key={`${link.label}-${link.href}`}
                href={link.href}
                aria-label={`Listen to ${artistName} on ${link.label}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-7 w-7 items-center justify-center text-ink transition-transform duration-200 hover:scale-110 hover:text-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
              >
                <Icon className="h-5 w-5" />
              </a>
            );
          })}
        </div>

        <div className="flex items-center gap-4 justify-self-start md:justify-self-end">
          <p className="text-left font-display text-[0.95rem] uppercase tracking-[0.2em] text-ink/80 md:text-right md:text-[1.05rem]">
            © {artistName} {new Date().getFullYear()}
            <br />
            All Rights Reserved
          </p>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
