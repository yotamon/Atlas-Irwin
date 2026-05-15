const DEFAULT_SITE_URL = "https://atlasirwin.com";

function isLocalUrl(url: URL) {
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1"
  );
}

export function getSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL;

  try {
    const url = new URL(configuredUrl);

    if (process.env.NODE_ENV === "production" && !isLocalUrl(url)) {
      url.protocol = "https:";
    }

    url.pathname = url.pathname.replace(/\/$/, "");

    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}
