import Link from "next/link";
import { CopyButton } from "@/components/studio/copy-button";
import { ContentForm } from "@/components/studio/content-form";
import { ContentStatusChips } from "@/components/studio/content-status-chips";
import {
  EmptyState,
  PageHeader,
  Status,
} from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  CONTENT_STATUSES,
  GOALS,
  PLATFORMS,
} from "@/lib/studio/constants";
import {
  deleteStudioRecord,
  duplicateContent,
} from "@/app/studio/actions";
import type { ContentItem } from "@/types/database";

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    release?: string;
    platform?: string;
    status?: string;
    goal?: string;
    edit?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  let query = supabase
    .from("content_items")
    .select("*")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });
  for (const key of ["release", "platform", "status", "goal"] as const) {
    if (params[key])
      query = query.eq(key === "release" ? "release_id" : key, params[key]!);
  }
  const [{ data: items }, { data: releases }] = await Promise.all([
    query,
    supabase.from("releases").select("id,title").eq("owner_id", user.id).order("title"),
  ]);
  const list = (items ?? []) as ContentItem[];
  const view = params.view ?? "kanban";
  const editing = params.edit
    ? list.find((item) => item.id === params.edit) ??
      (
        await supabase
          .from("content_items")
          .select("*")
          .eq("id", params.edit)
          .eq("owner_id", user.id)
          .maybeSingle()
      ).data
    : null;

  return (
    <>
      <PageHeader
        title="Content Lab"
        description="Develop, refine, and stage every piece before it goes live."
        action={
          <div className="actions">
            <a className="button primary" href="#new">
              New content item
            </a>
          </div>
        }
      />
      <form className="studio-tabs">
        <select name="release" defaultValue={params.release ?? ""}>
          <option value="">All releases</option>
          {releases?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
        <select name="platform" defaultValue={params.platform ?? ""}>
          <option value="">All platforms</option>
          {PLATFORMS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select name="status" defaultValue={params.status ?? ""}>
          <option value="">All statuses</option>
          {CONTENT_STATUSES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select name="goal" defaultValue={params.goal ?? ""}>
          <option value="">All goals</option>
          {GOALS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button className="button">Filter</button>
        <Link href={{ query: { ...params, view: "kanban", edit: undefined } }}>Kanban</Link>
        <Link href={{ query: { ...params, view: "list", edit: undefined } }}>List</Link>
      </form>

      {editing ? (
        <section className="studio-panel feature content-edit-panel" id={`edit-${editing.id}`}>
          <div className="panel-head">
            <h2>Edit · {editing.title}</h2>
            <Link className="text-button" href="/studio/content">
              Close
            </Link>
          </div>
          <ContentForm item={editing} releases={releases ?? []} />
        </section>
      ) : null}

      {!list.length ? (
        <EmptyState
          title="No content in the lab"
          body="Create an idea here or generate a release-specific content pack."
        />
      ) : view === "list" ? (
        <table className="studio-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Platform</th>
              <th>Format</th>
              <th>Status</th>
              <th>Schedule</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((item) => (
              <tr key={item.id} className={params.edit === item.id ? "is-editing" : undefined}>
                <td>
                  <Link href={`/studio/content?edit=${item.id}`}>{item.title}</Link>
                  <br />
                  <CopyButton value={item.hook_text} label="Copy hook" /> ·{" "}
                  <CopyButton value={item.caption} label="caption" /> ·{" "}
                  <CopyButton value={item.cta} label="CTA" /> ·{" "}
                  <CopyButton value={item.visual_prompt} label="prompt" />
                </td>
                <td>{item.platform}</td>
                <td>{item.format}</td>
                <td>
                  <Status>{item.status}</Status>
                  <ContentStatusChips id={item.id} status={item.status} />
                </td>
                <td>
                  {item.scheduled_at
                    ? new Date(item.scheduled_at).toLocaleString()
                    : "—"}
                </td>
                <td>
                  <Link className="text-button" href={`/studio/content?edit=${item.id}`}>
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="kanban">
          {CONTENT_STATUSES.filter((status) => status !== "Archived").map((status) => (
            <section className="kanban-column" key={status}>
              <h2>
                {status} · {list.filter((x) => x.status === status).length}
              </h2>
              {list
                .filter((x) => x.status === status)
                .map((item) => (
                  <article
                    className={`kanban-card ${params.edit === item.id ? "is-editing" : ""}`}
                    key={item.id}
                  >
                    <Status>{item.platform}</Status>
                    <h3>
                      <Link href={`/studio/content?edit=${item.id}`}>{item.title}</Link>
                    </h3>
                    <p>{item.hook_text || item.goal}</p>
                    <CopyButton value={item.caption} label="Copy caption" />
                    <ContentStatusChips id={item.id} status={item.status} />
                    <div className="kanban-actions">
                      <Link className="text-button" href={`/studio/content?edit=${item.id}`}>
                        Edit
                      </Link>
                      <form action={duplicateContent}>
                        <input type="hidden" name="id" value={item.id} />
                        <button className="text-button">Duplicate</button>
                      </form>
                      <form action={deleteStudioRecord}>
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="table" value="content_items" />
                        <button className="text-button">Delete</button>
                      </form>
                    </div>
                  </article>
                ))}
            </section>
          ))}
        </div>
      )}
      <section id="new" className="studio-panel feature">
        <div className="panel-head">
          <h2>Create content item</h2>
        </div>
        <ContentForm
          releases={releases ?? []}
          defaultReleaseId={params.release}
        />
      </section>
    </>
  );
}
