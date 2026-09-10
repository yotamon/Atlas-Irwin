"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactNode, RefObject } from "react";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className = "",
  initialFocusRef,
  returnFocusRef,
  closeLabel = "Close dialog",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  closeLabel?: string;
}) {
  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="ensemblis-dialog-backdrop" />
        <BaseDialog.Viewport className="ensemblis-dialog-viewport">
          <BaseDialog.Popup
            className={`ensemblis-dialog${className ? ` ${className}` : ""}`}
            initialFocus={initialFocusRef}
            finalFocus={returnFocusRef}
          >
            <header className="ensemblis-dialog-header">
              <div>
                <BaseDialog.Title>{title}</BaseDialog.Title>
                {description ? <BaseDialog.Description>{description}</BaseDialog.Description> : null}
              </div>
              <BaseDialog.Close className="ensemblis-dialog-close" aria-label={closeLabel}>
                <span aria-hidden>×</span>
              </BaseDialog.Close>
            </header>
            <div className="ensemblis-dialog-body">{children}</div>
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
