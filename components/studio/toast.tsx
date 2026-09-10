"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const FLASH_KEYS = [
  "notice",
  "error",
  "synced",
  "disconnected",
  "generated",
  "saved",
] as const;

type Flash = { tone: "success" | "error"; message: string };

function resolveFlash(params: URLSearchParams): Flash | null {
  const error = params.get("error");
  if (error) return { tone: "error", message: error };
  const notice = params.get("notice");
  if (notice) return { tone: "success", message: notice };
  if (params.get("synced") === "1")
    return { tone: "success", message: "Catalog synced." };
  if (params.get("disconnected") === "1")
    return { tone: "success", message: "Account disconnected." };
  if (params.get("generated") === "1")
    return { tone: "success", message: "Content pack prepared." };
  if (params.get("saved") === "1")
    return { tone: "success", message: "Saved." };
  return null;
}

export function StudioToast() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const fromUrl = resolveFlash(params);
  const [toast, setToast] = useState<Flash | null>(fromUrl);

  if (
    fromUrl &&
    (!toast ||
      fromUrl.message !== toast.message ||
      fromUrl.tone !== toast.tone)
  ) {
    setToast(fromUrl);
  }

  useEffect(() => {
    if (!fromUrl) return;
    const clean = new URLSearchParams(params.toString());
    let dirty = false;
    for (const key of FLASH_KEYS) {
      if (clean.has(key)) {
        clean.delete(key);
        dirty = true;
      }
    }
    if (!dirty) return;
    const query = clean.toString();
    const timer = window.setTimeout(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [fromUrl, params, pathname, router]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div
      className={`studio-toast ${toast.tone}`}
      role={toast.tone === "error" ? "alert" : "status"}
    >
      <span>{toast.message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setToast(null)}
      >
        ×
      </button>
    </div>
  );
}
