import type { Metadata } from "next";
import "./studio.css";
import "./video-director.css";
import "./video-director-states.css";
export const metadata: Metadata = {
  title: {
    default: "Atlas Release Engine",
    template: "%s · Atlas Release Engine",
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
