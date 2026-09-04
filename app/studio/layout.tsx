import type { Metadata, Viewport } from "next";
import { ENSEMBLIS_PRODUCT } from "@/lib/ensemblis-product";
import "./studio.css";
import "./studio-v2.css";
import "./studio-v2-workflows.css";
import "./studio-v2-safety.css";
import "./release-workspace-v2.css";
import "./release-growth.css";
import "./growth-os.css";
import "./growth-import.css";
import "./video-director.css";
import "./video-director-states.css";
import "./video-director-refinements.css";
import "./ai-control.css";
import "./distribution.css";
import "./distribution-release.css";
import "./ensemblis-shell.css";
import "./ensemblis-screens.css";
import "./ensemblis-root-isolation.css";
import "./ensemblis-states.css";
import "./ux-polish.css";

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
  themeColor: "#080b09",
  colorScheme: "dark",
};

export default function StudioRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="studio-root">{children}</div>;
}
