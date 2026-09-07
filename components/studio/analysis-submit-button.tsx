"use client";

import { useFormStatus } from "react-dom";

export function AnalysisSubmitButton({
  idleLabel,
  pendingLabel = "Starting analysis…",
  className = "button",
}: {
  idleLabel: string;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
