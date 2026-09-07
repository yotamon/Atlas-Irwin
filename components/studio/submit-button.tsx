"use client";

import { useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Dialog } from "./dialog";

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
  title = "Confirm this action",
  confirmLabel = "Continue",
}: {
  children: ReactNode;
  message: string;
  disabled?: boolean;
  title?: string;
  confirmLabel?: string;
}) {
  const { pending } = useFormStatus();
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function submitConfirmedAction() {
    const form = triggerRef.current?.form;
    setConfirming(false);
    window.requestAnimationFrame(() => form?.requestSubmit());
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="text-button danger-text"
        type="button"
        disabled={disabled || pending}
        aria-busy={pending}
        onClick={() => setConfirming(true)}
      >
        {pending ? <PendingSignal label="Working…" /> : children}
      </button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={title}
        description="This action is intentionally paused until you confirm it."
        returnFocusRef={triggerRef}
      >
        <p className="ensemblis-confirm-copy">{message}</p>
        <div className="ensemblis-confirm-actions">
          <button className="button" type="button" onClick={() => setConfirming(false)}>Cancel</button>
          <button className="button ensemblis-danger-button" type="button" onClick={submitConfirmedAction}>{confirmLabel}</button>
        </div>
      </Dialog>
    </>
  );
}
