import { loadTrustedHostRuntime } from "@/lib/sites/trusted-host-runtime";

type RouteContext = { params: Promise<{ siteId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { siteId } = await params;
  const resolved = await loadTrustedHostRuntime(siteId, request.headers);
  if (!resolved) return new Response(null, { status: 404 });

  const canonicalHost = resolved.runtime.primaryHostname || resolved.hostname;
  const body = [
    "User-agent: *",
    "Allow: /",
    `Sitemap: https://${canonicalHost}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
