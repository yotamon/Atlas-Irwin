import { BiLogoSoundcloud, BiLogoSpotify } from "react-icons/bi";
import { FaInstagram } from "react-icons/fa";

import { ThemeToggle } from "@/components/theme-toggle";

const socials = [
  {
    href: "https://open.spotify.com/artist/5BHcMdmbmxYwIFzqZvE3pc?si=a7EU_3TdQYSjGRAcvnJ8pg",
    label: "Spotify",
    icon: BiLogoSpotify,
  },
  {
    href: "https://soundcloud.com/atlas-irwin",
    label: "SoundCloud",
    icon: BiLogoSoundcloud,
  },
  {
    href: "https://instagram.com/atlasirwin",
    label: "Instagram",
    icon: FaInstagram,
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line/70 bg-paper/90">
      <div className="mx-auto grid w-full max-w-[1600px] grid-cols-1 items-end gap-5 px-5 pb-4 pt-5 sm:px-8 md:grid-cols-2 lg:px-12">
        <div className="flex items-center gap-4 md:justify-self-start">
          {socials.map(({ href, label, icon: Icon }) => (
            <a
              key={label}
              href={href}
              aria-label={label}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 w-7 items-center justify-center text-ink transition-transform duration-200 hover:scale-110 hover:text-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
            >
              <Icon className="h-5 w-5" />
            </a>
          ))}
        </div>

        <div className="flex items-center gap-4 justify-self-start md:justify-self-end">
          <p className="text-left font-display text-[0.95rem] uppercase tracking-[0.2em] text-ink/80 md:text-right md:text-[1.05rem]">
            © Atlas Irwin {new Date().getFullYear()}
            <br />
            All Rights Reserved
          </p>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
