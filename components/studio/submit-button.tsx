"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function SubmitButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button className="button primary" type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? "Saving…" : children}
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
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

