import { requireStudioAdmin } from "@/lib/auth/studio";
import { StudioSidebar } from "@/components/studio/sidebar";
export const dynamic = "force-dynamic";
export default async function ProtectedStudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireStudioAdmin();
  return (
    <div className="studio-shell">
      <StudioSidebar />
      <main className="studio-main">{children}</main>
    </div>
  );
}
