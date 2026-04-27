import { AboutSection } from "@/components/about-section";
import { ContactSection } from "@/components/contact-section";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { ListenPlatformsSection } from "@/components/listen-platforms-section";
import { Navbar } from "@/components/navbar";
import { ReleaseWidget } from "@/components/release-widget";
import { VisualsSection } from "@/components/visuals-section";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-paper text-ink">
      <Navbar />
      <main className="relative flex min-h-screen flex-col">
        <Hero />
        <ReleaseWidget />
        <ListenPlatformsSection />
        <VisualsSection />
        <AboutSection />
        <ContactSection />
        <Footer />
      </main>
    </div>
  );
}
