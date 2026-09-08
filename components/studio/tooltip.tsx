"use client";

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

export function EnsemblisTooltip({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactElement;
}) {
  return (
    <BaseTooltip.Provider delay={350} closeDelay={80}>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger render={children} />
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner className="ensemblis-tooltip-positioner" sideOffset={8}>
            <BaseTooltip.Popup className="ensemblis-tooltip-popup">
              <BaseTooltip.Arrow className="ensemblis-tooltip-arrow" />
              {label}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
