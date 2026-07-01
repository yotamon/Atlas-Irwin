import { AboutSection } from "@/components/about-section";
import { ContactSection } from "@/components/contact-section";
import { Footer } from "@/components/footer";
import { HashScrollRestorer } from "@/components/hash-scroll-restorer";
import { Hero } from "@/components/hero";
import { ListenPlatformsSection } from "@/components/listen-platforms-section";
import { Navbar } from "@/components/navbar";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { ReleaseWidget } from "@/components/release-widget";
import { buildMusicAlbumJsonLd } from "@/lib/catalog/json-ld";
import { getPublicReleases } from "@/lib/public-catalog";

export default async function Home() {
  const releases = await getPublicReleases();
  const albumJsonLd = buildMusicAlbumJsonLd(releases);

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {albumJsonLd.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(albumJsonLd) }}
        />
      )}
      <HashScrollRestorer />
      <Navbar />
      <main id="main-content" className="relative flex min-h-screen flex-col">
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
