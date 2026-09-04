export default function AppLoading() {
  return (
    <main
      className="grid min-h-screen place-items-center bg-[var(--paper)] text-[var(--ink)]"
      aria-busy="true"
      aria-label="Loading application"
    >
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        <span className="h-2 w-2 animate-pulse rounded-full bg-current opacity-35" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-current opacity-55 [animation-delay:120ms]" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-current opacity-75 [animation-delay:240ms]" />
        <span className="sr-only">Loading</span>
      </div>
    </main>
  );
}
