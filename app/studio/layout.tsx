import type { Metadata, Viewport } from "next";
import { ENSEMBLIS_PRODUCT } from "@/lib/ensemblis-product";
import "./design-system/index.css";

export const metadata: Metadata = {
  title: {
    default: ENSEMBLIS_PRODUCT.name,
    template: `%s · ${ENSEMBLIS_PRODUCT.name}`,
  },
  description: ENSEMBLIS_PRODUCT.promise,
  applicationName: ENSEMBLIS_PRODUCT.name,
  keywords: ["Ensemblis", "artist management", "music intelligence", "music marketing"],
  authors: [{ name: ENSEMBLIS_PRODUCT.name }],
  creator: ENSEMBLIS_PRODUCT.name,
  publisher: ENSEMBLIS_PRODUCT.name,
  manifest: "/studio/manifest.webmanifest",
  icons: {
    icon: [{ url: "/ensemblis-mark.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/ensemblis-mark.svg", type: "image/svg+xml" }],
    apple: [{ url: "/ensemblis-mark.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: ENSEMBLIS_PRODUCT.name,
    description: ENSEMBLIS_PRODUCT.promise,
    siteName: ENSEMBLIS_PRODUCT.name,
    type: "website",
    images: [],
  },
  twitter: {
    card: "summary",
    title: ENSEMBLIS_PRODUCT.name,
    description: ENSEMBLIS_PRODUCT.promise,
    images: [],
  },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  // Browser metadata cannot reference CSS custom properties. Keep this literal
  // synchronized with --en-bg in design-system/tokens.css.
  themeColor: "#080b09",
  colorScheme: "dark",
};

export default function StudioRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="studio-root">{children}</div>;
}
