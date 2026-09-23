import type { Metadata, Viewport } from "next";
import { Instrument_Serif } from "next/font/google";
import { marketingPath } from "@/lib/marketing-site/content";
import "../studio/design-system/tokens.css";
import "./website.css";

const editorial = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-editorial",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Ensemblis — Your music. Understood.",
    template: "%s — Ensemblis",
  },
  description:
    "Music intelligence for artists, producers and DJs. Understand your tracks, refine your sound, build mixes and create promotion around your music.",
  robots: { index: false, follow: false },
  manifest: marketingPath("/manifest.webmanifest"),
  openGraph: {
    title: "Ensemblis — Your music. Understood.",
    description: "Understand it. Refine it. Mix it. Promote it.",
    type: "website",
    siteName: "Ensemblis",
  },
  twitter: { card: "summary_large_image" },
  icons: { icon: "/ensemblis-mark.svg", apple: "/ensemblis-mark.svg" },
};
export const viewport: Viewport = { themeColor: "#080b09" };

export default function WebsiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={editorial.variable}>
      {/* The inherited app/loading.tsx streams this static route into a hidden
          Suspense container. Without JS, expose only the marketing container,
          preserving the other application's loading behavior. No framework IDs. */}
      <noscript>
        <style>{`
        @layer base { [hidden]:has(.marketing-root) { display: block !important; } }
        body:has(.marketing-root) > main[aria-label="Loading application"] { display: none; }
      `}</style>
      </noscript>
      {children}
    </div>
  );
}
