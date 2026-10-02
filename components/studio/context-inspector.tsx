"use client";

import { useRef, useState, type ReactNode } from "react";
import { Dialog } from "@/components/studio/dialog";
import { emitStudioUxEvent } from "@/lib/studio/ux-telemetry-client";

export function ContextInspector({
  title,
  description,
  triggerLabel = "Details",
  children,
  triggerClassName = "button",
}: {
  title: ReactNode;
  description?: ReactNode;
  triggerLabel?: string;
  children: ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button
        ref={triggerRef}
        className={triggerClassName}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          emitStudioUxEvent({ event: "advanced_opened", source: "context_inspector" });
        }}
      >
        {triggerLabel}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        className="ensemblis-context-inspector"
        returnFocusRef={triggerRef}
        closeLabel="Close details"
      >
        {children}
      </Dialog>
    </>
  );
}
