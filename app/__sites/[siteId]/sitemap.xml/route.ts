import { loadTrustedHostRuntime } from "@/lib/sites/trusted-host-runtime";

type RouteContext = { params: Promise<{ siteId: string }> };

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET(request: Request, { params }: RouteContext) {
  const { siteId } = await params;
  const resolved = await loadTrustedHostRuntime(siteId, request.headers);
  if (!resolved) return new Response(null, { status: 404 });

  const canonicalHost = resolved.runtime.primaryHostname || resolved.hostname;
  const location = escapeXml(`https://${canonicalHost}/`);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${location}</loc></url>`,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
