export const LOCAL_STUDIO_EMAIL = "local-studio@atlas-irwin.dev";
export const LOCAL_STUDIO_USER_ID = "00000000-0000-4000-8000-000000000001";

export function isLocalHost(host: string | undefined) {
  const normalizedHost = host?.toLowerCase();

  return Boolean(
    normalizedHost &&
      (normalizedHost.startsWith("localhost") ||
        normalizedHost.startsWith("127.0.0.1") ||
        normalizedHost.startsWith("[::1]") ||
        normalizedHost === "::1"),
  );
}

export function isLocalStudioBypassHost(host: string | undefined) {
  return process.env.NODE_ENV !== "production" && isLocalHost(host);
}
