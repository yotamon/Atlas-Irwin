import Link from "next/link";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { EmptyState, PageHeader, Status } from "@/components/studio/ui";
export default async function ReleasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { supabase } = await requireStudioAdmin();
  const params = await searchParams;
  let query = supabase
    .from("releases")
    .select("*")
    .order("updated_at", { ascending: false });
  if (params.status) query = query.eq("status", params.status);
  if (params.q) query = query.ilike("title", `%${params.q}%`);
  const { data } = await query;
  return (
    <>
      <PageHeader
        title="Releases"
        description="From approved master to long-tail audience growth."
        action={
          <Link className="button primary" href="/studio/releases/new">
            New release
          </Link>
        }
      />
      <form className="studio-tabs">
        <input name="q" placeholder="Search releases" defaultValue={params.q} />
        <select name="status" defaultValue={params.status}>
          <option value="">All statuses</option>
          {["Idea", "In Progress", "Scheduled", "Live", "Archived"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button className="button">Filter</button>
      </form>
      {data?.length ? (
        <table className="studio-table">
          <thead>
            <tr>
              <th>Release</th>
              <th>Type</th>
              <th>Status</th>
              <th>Date</th>
              <th>Public sync</th>
            </tr>
          </thead>
          <tbody>
            {data.map((release) => (
              <tr key={release.id}>
                <td>
                  <Link href={`/studio/releases/${release.id}`}>
                    <strong>{release.title}</strong>
                    <br />
                    <small>{release.slug}</small>
                  </Link>
                </td>
                <td>{release.release_type}</td>
                <td>
                  <Status>{release.status}</Status>
                </td>
                <td>
                  {release.release_date
                    ? new Date(release.release_date).toLocaleDateString()
                    : "Unscheduled"}
                </td>
                <td>
                  {release.public_release_path
                    ? "Linked · manual sync"
                    : "Studio only"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState
          title="The catalog starts here"
          body="Create a release or import existing public manifests with the included script."
          href="/studio/releases/new"
          label="Create release"
        />
      )}
    </>
  );
}
