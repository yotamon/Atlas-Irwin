"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

function PendingSignal({ label }: { label: ReactNode }) {
  return (
    <span className="ensemblis-button-pending">
      <span className="ensemblis-button-signal" aria-hidden="true"><i /><i /><i /></span>
      <span>{label}</span>
    </span>
  );
}

export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  className = "button primary",
  disabled = false,
}: {
  children: ReactNode;
  pendingLabel?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      type="submit"
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      aria-busy={pending}
    >
      {pending ? <PendingSignal label={pendingLabel} /> : children}
    </button>
  );
}

export function ConfirmButton({
  children,
  message,
  disabled = false,
}: {
  children: ReactNode;
  message: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className="text-button danger-text"
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {pending ? <PendingSignal label="Working…" /> : children}
    </button>
  );
}
