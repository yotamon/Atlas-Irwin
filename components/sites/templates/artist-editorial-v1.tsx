import Link from "next/link";
import type { CSSProperties } from "react";
import type { ArtistSiteConfig, SiteSectionKey, SiteViewModel } from "@/types/ensemblis-sites";

type Props = {
  config: ArtistSiteConfig;
  viewModel: SiteViewModel;
  preview?: boolean;
};

function ReleaseGrid({ viewModel, config }: Pick<Props, "viewModel" | "config">) {
  const highlighted = new Set(config.highlightedReleaseIds);
  const releases = [...viewModel.releases].sort((left, right) => {
    const priority = Number(highlighted.has(right.id)) - Number(highlighted.has(left.id));
    if (priority) return priority;
    return (right.releaseDate || "").localeCompare(left.releaseDate || "");
  });

  return (
    <section className="artist-site-section" id="music">
      <div className="artist-site-section-head">
        <span>Music</span>
        <h2>Releases</h2>
      </div>
      {releases.length ? (
        <div className="artist-site-release-grid">
          {releases.map((release) => (
            <article className="artist-site-release" key={release.id}>
              {release.artworkUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={release.artworkUrl} alt={`${release.title} cover`} loading="lazy" />
              ) : (
                <div className="artist-site-cover-placeholder" aria-hidden />
              )}
              <div className="artist-site-release-copy">
                <p>{release.releaseType}{release.genre ? ` · ${release.genre}` : ""}</p>
                <h3>{release.title}</h3>
                {release.story ? <small>{release.story}</small> : null}
                <div className="artist-site-link-row">
                  {release.links.slice(0, 4).map((link) => (
                    <a key={`${release.id}-${link.href}`} href={link.href} rel="noreferrer" target="_blank">
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="artist-site-empty">New music will appear here when it is published.</p>
      )}
    </section>
  );
}

function renderSection(section: SiteSectionKey, props: Props) {
  const { config, viewModel } = props;
  if (config.hiddenSections.includes(section)) return null;

  if (section === "hero") {
    return (
      <section className="artist-site-hero" key={section}>
        <span className="artist-site-kicker">{config.heroEyebrow || "Official artist site"}</span>
        <h1>{viewModel.artist.name}</h1>
        <p>{config.heroCopy || viewModel.seo.description}</p>
        <a className="artist-site-primary-cta" href="#music">Listen now</a>
      </section>
    );
  }

  if (section === "releases") return <ReleaseGrid key={section} viewModel={viewModel} config={config} />;

  if (section === "about" && viewModel.artist.bio) {
    return (
      <section className="artist-site-section artist-site-copy-section" key={section} id="about">
        <div className="artist-site-section-head"><span>About</span><h2>{viewModel.artist.name}</h2></div>
        <p>{viewModel.artist.bio}</p>
      </section>
    );
  }

  if (section === "links" && viewModel.socialLinks.length) {
    return (
      <section className="artist-site-section artist-site-copy-section" key={section}>
        <div className="artist-site-section-head"><span>Follow</span><h2>Elsewhere</h2></div>
        <div className="artist-site-link-row">
          {viewModel.socialLinks.map((link) => (
            <a key={link.href} href={link.href} rel="noreferrer" target="_blank">{link.label}</a>
          ))}
        </div>
      </section>
    );
  }

  if (section === "contact" && viewModel.contact.email) {
    return (
      <section className="artist-site-section artist-site-copy-section" key={section} id="contact">
        <div className="artist-site-section-head"><span>Contact</span><h2>Get in touch</h2></div>
        <a href={`mailto:${viewModel.contact.email}`}>{viewModel.contact.email}</a>
      </section>
    );
  }

  return null;
}

export function ArtistEditorialTemplate(props: Props) {
  const { config, viewModel, preview } = props;
  const style = {
    "--artist-bg": config.theme.background,
    "--artist-fg": config.theme.foreground,
    "--artist-muted": config.theme.muted,
    "--artist-accent": viewModel.artist.accentColor || config.theme.accent,
    "--artist-surface": config.theme.surface,
  } as CSSProperties;

  return (
    <div className="artist-site-root" style={style}>
      {preview ? <div className="artist-site-preview-ribbon">Private draft preview</div> : null}
      <header className="artist-site-nav">
        <Link href="#top" className="artist-site-name">{viewModel.artist.name}</Link>
        <nav aria-label="Artist site navigation">
          <a href="#music">Music</a>
          {viewModel.artist.bio ? <a href="#about">About</a> : null}
          {viewModel.contact.email ? <a href="#contact">Contact</a> : null}
        </nav>
      </header>
      <main id="top">
        {config.sectionOrder.map((section) => renderSection(section, props))}
      </main>
      <footer className="artist-site-footer">
        <strong>{viewModel.artist.name}</strong>
        <span>© {new Date().getUTCFullYear()}</span>
      </footer>
    </div>
  );
}
