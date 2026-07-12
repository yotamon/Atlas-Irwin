import { Suspense } from "react";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { StudioSidebar } from "@/components/studio/sidebar";
import { StudioToast } from "@/components/studio/toast";
import type { SearchHit } from "@/components/studio/global-search";

export const dynamic = "force-dynamic";

export default async function ProtectedStudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user } = await requireStudioAdmin();
  const [releases, content, contacts, assets, tasks] = await Promise.all([
    supabase.from("releases").select("id,title,status").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(40),
    supabase.from("content_items").select("id,title,platform,status").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(40),
    supabase.from("outreach_contacts").select("id,name,contact_type").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(40),
    supabase.from("media_assets").select("id,asset_type,metadata").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(40),
    supabase.from("tasks").select("id,title,status,priority").eq("owner_id", user.id).neq("status", "Done").order("due_at").limit(40),
  ]);

  const searchItems: SearchHit[] = [
    ...(releases.data ?? []).map((item) => ({
      id: item.id,
      kind: "Release" as const,
      title: item.title,
      meta: item.status,
      href: `/studio/releases/${item.id}`,
    })),
    ...(content.data ?? []).map((item) => ({
      id: item.id,
      kind: "Content" as const,
      title: item.title,
      meta: `${item.platform} · ${item.status}`,
      href: `/studio/content?edit=${item.id}`,
    })),
    ...(contacts.data ?? []).map((item) => ({
      id: item.id,
      kind: "Contact" as const,
      title: item.name,
      meta: item.contact_type,
      href: `/studio/outreach/${item.id}`,
    })),
    ...(assets.data ?? []).map((item) => {
      const meta = item.metadata as { original_filename?: string; tags?: string[] } | null;
      return {
        id: item.id,
        kind: "Asset" as const,
        title: meta?.original_filename || item.asset_type,
        meta: item.asset_type,
        href: `/studio/media?asset=${item.id}#asset-${item.id}`,
      };
    }),
    ...(tasks.data ?? []).map((item) => ({
      id: item.id,
      kind: "Task" as const,
      title: item.title,
      meta: `${item.priority} · ${item.status}`,
      href: `/studio/tasks#task-${item.id}`,
    })),
  ];

  return (
    <div className="studio-shell">
      <StudioSidebar searchItems={searchItems} />
      <main className="studio-main">
        <Suspense fallback={null}>
          <StudioToast />
        </Suspense>
        {children}
      </main>
    </div>
  );
}
