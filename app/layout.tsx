import type { Metadata } from "next";
import localFont from "next/font/local";
import { Manrope } from "next/font/google";
import { getSiteUrl } from "@/lib/site-url";
import { ThemeInitScript } from "@/components/theme-init-script";
import "./globals.css";

const headingFont = localFont({
  src: "../public/fonts/montage_2/Montage-Demo.ttf",
  variable: "--font-heading",
  display: "swap",
});

const bodyFont = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

const SITE_URL = getSiteUrl();

const SITE_TITLE = "Atlas Irwin — Retro-Futuristic Electronic Music";
const SITE_DESCRIPTION =
  "Atlas Irwin is a retro-futuristic electronic music project rooted in nu-disco, funk, house, and EDM, blending soulful warmth, polished club energy, and luminous electronic texture.";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  keywords: [
    "Atlas Irwin",
    "retro-futuristic",
    "electronic music",
    "nu-disco",
    "funk",
    "house",
    "EDM",
    "AI music tools",
    "EP",
    "singles",
    "remix",
    "SoundCloud",
    "Spotify",
    "booking",
  ],
  authors: [{ name: "Atlas Irwin", url: SITE_URL }],
  creator: "Atlas Irwin",
  publisher: "Atlas Irwin",
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: "Atlas Irwin",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/atlas-cover.png",
        width: 1200,
        height: 630,
        alt: "Atlas Irwin",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/atlas-cover.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  other: {
    "theme-color": "#f4eddd",
    "color-scheme": "light dark",
  },
};

const jsonLdWebsite = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Atlas Irwin",
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  inLanguage: "en",
};

const jsonLdMusicGroup = {
  "@context": "https://schema.org",
  "@type": "MusicGroup",
  name: "Atlas Irwin",
  url: SITE_URL,
  genre: "Electronic",
  sameAs: [
    "https://soundcloud.com/atlas-irwin",
    "https://open.spotify.com/artist/5BHcMdmbmxYwIFzqZvE3pc",
    "https://music.apple.com/us/artist/atlas-irwin/1895148790",
    "https://www.youtube.com/@AtlasIrwin",
    "https://www.deezer.com/en/artist/386920031",
  ],
  image: `${SITE_URL}/atlas-cover.png`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-theme="light"
      className={`${headingFont.variable} ${bodyFont.variable}`}
    >
      <head>
        <meta
          name="theme-color"
          content="#f4eddd"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#101111"
          media="(prefers-color-scheme: dark)"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdWebsite) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdMusicGroup) }}
        />
      </head>
      <body className="flex min-h-screen flex-col">
        <ThemeInitScript />
        {children}
      </body>
    </html>
  );
}
