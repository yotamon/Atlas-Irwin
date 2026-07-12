const DEFAULT_SITE_URL = "https://atlasirwin.com";

function isLocalUrl(url: URL) {
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1"
  );
}

function readConfiguredSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredUrl) return configuredUrl;

  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionUrl) {
    return productionUrl.startsWith("http")
      ? productionUrl
      : `https://${productionUrl}`;
  }

  return DEFAULT_SITE_URL;
}

export function getSiteUrl() {
  try {
    const url = new URL(readConfiguredSiteUrl());

    if (process.env.NODE_ENV === "production" && !isLocalUrl(url)) {
      url.protocol = "https:";
    }

    url.pathname = url.pathname.replace(/\/$/, "");

    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}
