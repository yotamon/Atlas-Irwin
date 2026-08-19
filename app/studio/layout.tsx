import type { Metadata } from "next";
import "./studio.css";
import "./studio-v2.css";
import "./video-director.css";
import "./video-director-states.css";
import "./video-director-refinements.css";

export const metadata: Metadata = {
  title: {
    default: "Atlas Studio",
    template: "%s · Atlas Studio",
  },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function StudioRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="studio-root">{children}</div>;
}
