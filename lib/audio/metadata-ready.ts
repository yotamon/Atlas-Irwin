/** Wait for an explicitly requested source without leaving listeners or timers behind. */
export function metadataReady(element: HTMLAudioElement, signal: AbortSignal) {
  signal.throwIfAborted();
  if (element.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      element.removeEventListener("loadedmetadata", done);
      element.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("One of the Audio Scene sources could not be loaded."));
    };
    const aborted = () => {
      cleanup();
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Audio source took too long to become playable."));
    }, 10000);

    element.addEventListener("loadedmetadata", done, { once: true });
    element.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    // A seek can supersede a pending play. Reuse its load instead of restarting it.
    if (element.networkState !== HTMLMediaElement.NETWORK_LOADING) {
      try {
        element.preload = "metadata";
        element.load();
      } catch (error) {
        cleanup();
        reject(error);
      }
    }
  });
}
