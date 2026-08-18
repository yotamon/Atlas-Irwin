export default function VideoProjectLoading() {
  return (
    <div className="video-project-workspace video-loading-shell" aria-busy="true" aria-label="Loading video production">
      <div className="video-loading-block hero" />
      <div className="video-loading-block rail" />
      <div className="video-loading-block cue" />
      <div className="video-production-layout">
        <main className="workspace-stack">
          <div className="video-loading-block panel" />
          <div className="video-loading-block panel tall" />
          <div className="video-loading-block panel" />
        </main>
        <aside className="video-production-sidebar"><div className="video-loading-block side" /></aside>
      </div>
    </div>
  );
}
