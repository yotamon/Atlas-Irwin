export default function HomeLoading() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-x-0 top-0 z-50 min-h-[5.4rem] border-b border-transparent sm:min-h-[6.8rem]" />
      <main
        id="main-content"
        className="relative flex min-h-screen flex-col"
        aria-busy="true"
        aria-label="Loading homepage"
      >
        <section className="hero-scene relative min-h-svh bg-paper pb-35 sm:pb-50">
          <div className="hero-copy absolute left-5 top-[9.4rem] flex w-[calc(100%-2.5rem)] max-w-140 flex-col sm:left-[4.25vw] sm:top-[8.8rem]">
            <div className="mt-8 h-36 w-64 animate-pulse rounded-2xl bg-ink/10 sm:h-44 sm:w-80" />
            <div className="mt-6 h-16 w-52 animate-pulse rounded-xl bg-ink/8" />
            <div className="mt-8 flex gap-4">
              <div className="h-12 w-44 animate-pulse rounded-full bg-ink/10" />
              <div className="h-12 w-28 animate-pulse rounded-full bg-ink/8" />
            </div>
          </div>
        </section>
        <section className="relative -top-19 z-30 mx-auto -mb-19 w-full max-w-295 scroll-mt-32 px-5 pb-2 sm:-top-25 sm:-mb-25 sm:px-8 lg:px-0">
          <div className="paper-card rounded-[1.85rem] border border-ink/20 p-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)]">
              <div className="aspect-[9/16] animate-pulse rounded-[1.55rem] bg-ink/10" />
              <div className="flex flex-col gap-4">
                <div className="h-8 w-40 animate-pulse rounded-full bg-ink/10" />
                <div className="h-14 w-3/4 animate-pulse rounded-2xl bg-ink/8" />
                <div className="mt-auto h-24 animate-pulse rounded-[1.2rem] bg-ink/6" />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
