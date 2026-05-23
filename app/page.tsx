import { AboutSection } from "@/components/about-section";
import { ContactSection } from "@/components/contact-section";
import { Footer } from "@/components/footer";
import { HashScrollRestorer } from "@/components/hash-scroll-restorer";
import { Hero } from "@/components/hero";
import { ListenPlatformsSection } from "@/components/listen-platforms-section";
import { Navbar } from "@/components/navbar";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { ReleaseWidget } from "@/components/release-widget";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <HashScrollRestorer />
      <Navbar />
      <main className="relative flex min-h-screen flex-col">
        <Hero />
        <ReleaseWidget />
        <ListenPlatformsSection />
        <AboutSection />
        <ContactSection />
        <NewsletterSignup />
        <Footer />
      </main>
    </div>
  );
}
