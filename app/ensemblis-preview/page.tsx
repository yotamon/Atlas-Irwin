import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import { EnsemblisMarketingPrototype } from "./prototype";

const editorial = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-ensemblis-editorial",
});

export const metadata: Metadata = {
  title: "Ensemblis Marketing Prototype",
  description: "Internal visual prototype for the future Ensemblis marketing website.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function EnsemblisPreviewPage() {
  return (
    <main className={editorial.variable}>
      <EnsemblisMarketingPrototype />
    </main>
  );
}
