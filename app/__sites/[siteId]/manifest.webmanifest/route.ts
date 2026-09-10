import { loadTrustedHostRuntime } from "@/lib/sites/trusted-host-runtime";

type RouteContext = { params: Promise<{ siteId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { siteId } = await params;
  const resolved = await loadTrustedHostRuntime(siteId, request.headers);
  if (!resolved) return new Response(null, { status: 404 });

  const { viewModel, config } = resolved.runtime;
  return Response.json(
    {
      name: viewModel.artist.name,
      short_name: viewModel.artist.name,
      description: viewModel.seo.description,
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: config.theme.background,
      theme_color: config.theme.background,
    },
    { headers: { "Content-Type": "application/manifest+json; charset=utf-8" } },
  );
}
