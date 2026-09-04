export default function StudioLoading() {
  return (
    <div className="studio-v2-page ensemblis-workspace-loading" role="status" aria-live="polite" aria-label="Loading workspace">
      <header className="ensemblis-loading-header">
        <span className="ensemblis-loading-kicker">Ensemblis</span>
        <span className="ensemblis-loading-line title" />
        <span className="ensemblis-loading-line copy" />
      </header>
      <section className="ensemblis-loading-primary" aria-hidden="true">
        <span className="ensemblis-loading-line micro" />
        <span className="ensemblis-loading-line heading" />
        <span className="ensemblis-loading-line body" />
        <span className="ensemblis-loading-line body short" />
      </section>
      <div className="ensemblis-loading-columns" aria-hidden="true">
        <section><span /><span /><span /></section>
        <section><span /><span /><span /></section>
      </div>
      <span className="sr-only">Loading workspace…</span>
    </div>
  );
}
