import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: {
    default: ENSEMBLIS_PRODUCT.name,
    template: `%s · ${ENSEMBLIS_PRODUCT.name}`,
  },
  description: ENSEMBLIS_PRODUCT.promise,
  applicationName: ENSEMBLIS_PRODUCT.name,
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function StudioRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="studio-root">{children}</div>;
}
