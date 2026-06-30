"use client";
export default function StudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="studio-auth">
      <section>
        <h1>Signal interrupted</h1>
        <p>{error.message || "The Studio could not complete that request."}</p>
        <button className="button primary" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
