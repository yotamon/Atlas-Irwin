import { loadPublishedSiteBySlug } from "@/lib/sites/runtime";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { slug } = await params;
  const runtime = await loadPublishedSiteBySlug(slug);
  if (!runtime) return new Response(null, { status: 404 });

  const { viewModel, config } = runtime;
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
