import { loadPublishedSiteBySlug } from "@/lib/sites/runtime";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { slug } = await params;
  const runtime = await loadPublishedSiteBySlug(slug);
  if (!runtime) return new Response(null, { status: 404 });

  // Artist-specific icons are not editable yet. Returning no icon prevents the
  // shared legacy Atlas favicon from leaking onto another artist's hostname.
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
