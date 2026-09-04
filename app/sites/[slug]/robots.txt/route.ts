import { loadPublishedSiteBySlug } from "@/lib/sites/runtime";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { slug } = await params;
  const runtime = await loadPublishedSiteBySlug(slug);
  if (!runtime) return new Response(null, { status: 404 });

  const canonicalHost = runtime.primaryHostname;
  const body = canonicalHost
    ? [
        "User-agent: *",
        "Allow: /",
        `Sitemap: https://${canonicalHost}/sitemap.xml`,
        "",
      ].join("\n")
    : ["User-agent: *", "Disallow: /", ""].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
