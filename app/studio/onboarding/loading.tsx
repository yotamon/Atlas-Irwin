export default function OnboardingLoading() {
  return (
    <div className="ensemblis-onboarding-shell" aria-busy="true" aria-live="polite">
      <main className="ensemblis-onboarding-card">
        <div className="ensemblis-onboarding-intro">
          <span className="section-label">First useful loop</span>
          <h1>Reading the artist and music state</h1>
          <p>Ensemblis is finding the next real action. It will not ask you to repeat setup that already exists.</p>
        </div>
        <section className="ensemblis-onboarding-action">
          <span className="section-label">Working</span>
          <h2>Preparing the next useful step</h2>
          <p>Music, Track Intelligence, Release Mission and Moment state stay authoritative while this loads.</p>
        </section>
      </main>
    </div>
  );
}
