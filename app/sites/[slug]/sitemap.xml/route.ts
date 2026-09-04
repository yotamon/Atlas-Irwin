import { loadPublishedSiteBySlug } from "@/lib/sites/runtime";

type RouteContext = { params: Promise<{ slug: string }> };

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { slug } = await params;
  const runtime = await loadPublishedSiteBySlug(slug);
  if (!runtime?.primaryHostname) return new Response(null, { status: 404 });

  const location = escapeXml(`https://${runtime.primaryHostname}/`);
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
