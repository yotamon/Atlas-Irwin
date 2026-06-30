"use client";
import { useState } from "react";
export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string | null;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="text-button"
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value ?? "");
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}
