"use client";

import { useTransition } from "react";
import { updateContentStatus } from "@/app/studio/actions";
import { CONTENT_STATUSES } from "@/lib/studio/constants";

export function ContentStatusChips({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const currentIndex = CONTENT_STATUSES.indexOf(
    status as (typeof CONTENT_STATUSES)[number],
  );
  const neighbors = CONTENT_STATUSES.filter((_, index) => {
    if (index === currentIndex) return false;
    return Math.abs(index - currentIndex) <= 1 || index === CONTENT_STATUSES.length - 1;
  }).slice(0, 3);

  return (
    <div className="status-chips" aria-busy={pending}>
      {neighbors.map((next) => (
        <button
          key={next}
          type="button"
          className="text-button"
          disabled={pending}
          onClick={() => {
            const form = new FormData();
            form.set("id", id);
            form.set("status", next);
            startTransition(async () => {
              await updateContentStatus(form);
            });
          }}
        >
          → {next}
        </button>
      ))}
    </div>
  );
}
