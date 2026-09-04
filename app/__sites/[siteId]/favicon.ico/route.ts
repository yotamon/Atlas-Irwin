import { loadTrustedHostRuntime } from "@/lib/sites/trusted-host-runtime";

type RouteContext = { params: Promise<{ siteId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { siteId } = await params;
  const resolved = await loadTrustedHostRuntime(siteId, request.headers);
  if (!resolved) return new Response(null, { status: 404 });

  // Site-specific icons are a later editor surface. Returning no icon is safer
  // than leaking the shared legacy Atlas favicon onto another artist's domain.
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
