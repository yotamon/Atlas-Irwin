import Link from "next/link";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ReleaseCatalog } from "@/components/studio/release-catalog";
import { EmptyState, PageHeader } from "@/components/studio/ui";
import type { HomepagePlacement, Release } from "@/types/database";

type ReleaseWithPlacement = Release & {
  homepage_placements: HomepagePlacement[];
};

export default async function ReleasesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    publish?: string;
    homepage?: string;
    view?: string;
  }>;
}) {
  const { supabase, user } = await requireStudioAdmin();
  const params = await searchParams;
  let query = supabase
    .from("releases")
    .select("*")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });
  if (params.status) query = query.eq("status", params.status);
  if (params.publish) query = query.eq("publish_state", params.publish);
  if (params.q) query = query.ilike("title", `%${params.q}%`);
  const [{ data: releases }, { data: placements }] = await Promise.all([
    query,
    supabase.from("homepage_placements").select("*").eq("owner_id", user.id),
  ]);

  const placementByRelease = new Map(
    (placements ?? []).map((placement) => [placement.release_id, placement]),
  );
  const enriched: ReleaseWithPlacement[] = (releases ?? []).map((release) => ({
    ...release,
    homepage_placements: placementByRelease.has(release.id)
      ? [placementByRelease.get(release.id)!]
      : [],
  }));

  const filtered =
    params.homepage === "visible"
      ? enriched.filter((release) => release.homepage_placements.some((placement) => placement.enabled))
      : params.homepage === "hidden"
        ? enriched.filter((release) => !release.homepage_placements.some((placement) => placement.enabled))
        : enriched;

  return (
    <>
      <PageHeader
        title="Catalog"
        description="Manage releases, publishing state, homepage visibility, and media readiness."
        action={
          <Link className="button primary" href="/studio/releases/new">
            New release
          </Link>
        }
      />
      {filtered.length ? (
        <ReleaseCatalog
          releases={filtered}
          view={params.view === "table" ? "table" : "grid"}
          filters={params}
        />
      ) : (
        <EmptyState
          title="The catalog starts here"
          body="Create a release or import legacy public folders with npm run studio:import."
          href="/studio/releases/new"
          label="Create release"
        />
      )}
    </>
  );
}
