"use client";

import { useEffect } from "react";

export function PublicMediaMotionController() {
  useEffect(() => {
    const root = document.getElementById("release-widget");
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cleanups = new Map<HTMLVideoElement, () => void>();

    function configureVideo(video: HTMLVideoElement) {
      cleanups.get(video)?.();
      video.muted = true;
      const trigger = video.closest("button");
      const isFeaturedCanvas = !trigger;

      if (reducedMotion.matches) {
        video.autoplay = false;
        video.preload = "metadata";
        video.pause();
        cleanups.set(video, () => undefined);
        return;
      }

      if (isFeaturedCanvas) {
        video.autoplay = true;
        video.preload = "metadata";
        void video.play().catch(() => undefined);
        cleanups.set(video, () => video.pause());
        return;
      }

      video.autoplay = false;
      video.preload = "none";
      video.pause();

      const playPreview = () => void video.play().catch(() => undefined);
      const pausePreview = () => {
        video.pause();
        try { video.currentTime = 0; } catch { /* metadata may not be ready yet */ }
      };
      trigger.addEventListener("pointerenter", playPreview);
      trigger.addEventListener("focusin", playPreview);
      trigger.addEventListener("pointerleave", pausePreview);
      trigger.addEventListener("focusout", pausePreview);
      cleanups.set(video, () => {
        trigger.removeEventListener("pointerenter", playPreview);
        trigger.removeEventListener("focusin", playPreview);
        trigger.removeEventListener("pointerleave", pausePreview);
        trigger.removeEventListener("focusout", pausePreview);
        video.pause();
      });
    }

    function sync() {
      const videos = Array.from(root.querySelectorAll<HTMLVideoElement>("video"));
      videos.forEach(configureVideo);
      for (const video of cleanups.keys()) {
        if (!videos.includes(video)) {
          cleanups.get(video)?.();
          cleanups.delete(video);
        }
      }
    }

    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    reducedMotion.addEventListener("change", sync);
    sync();

    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", sync);
      cleanups.forEach((cleanup) => cleanup());
      cleanups.clear();
    };
  }, []);

  return null;
}
