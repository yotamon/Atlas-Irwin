import { EnsemblisMark } from "@/components/ensemblis-logo";

export default function Loading() {
  return (
    <div className="ensemblis-loading" role="status" aria-live="polite">
      <EnsemblisMark />
      <div>
        <strong>Ensemblis</strong>
        <span>Loading artist context…</span>
      </div>
    </div>
  );
}
