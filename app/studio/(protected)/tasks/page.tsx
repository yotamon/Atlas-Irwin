import Link from "next/link";
import {
  completeTask,
  deleteStudioRecord,
  saveTask,
} from "@/app/studio/actions";
import {
  EmptyState,
  Field,
  PageHeader,
  Status,
  Submit,
} from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/studio/constants";

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; release?: string }>;
}) {
  const params = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  let query = supabase
    .from("tasks")
    .select("*")
    .eq("owner_id", user.id)
    .order("due_at", { ascending: true, nullsFirst: false });
  if (params.status) query = query.eq("status", params.status);
  if (params.release) query = query.eq("release_id", params.release);
  const [{ data: tasks }, { data: releases }] = await Promise.all([
    query,
    supabase
      .from("releases")
      .select("id,title")
      .eq("owner_id", user.id)
      .order("title"),
  ]);
  const open = (tasks ?? []).filter((task) => task.status !== "Done");
  const done = (tasks ?? []).filter((task) => task.status === "Done");

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Concrete workload behind the Command Center runway."
        action={
          <a className="button primary" href="#new">
            New task
          </a>
        }
      />

      <form className="studio-tabs">
        <select name="status" defaultValue={params.status ?? ""}>
          <option value="">All statuses</option>
          {TASK_STATUSES.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
        <select name="release" defaultValue={params.release ?? ""}>
          <option value="">All releases</option>
          {releases?.map((release) => (
            <option key={release.id} value={release.id}>
              {release.title}
            </option>
          ))}
        </select>
        <button className="button">Filter</button>
      </form>

      <div className="studio-grid task-overview">
        <section className="studio-panel">
          <div className="panel-head">
            <h2>Open</h2>
          </div>
          <p className="metric-figure">{open.length}</p>
        </section>
        <section className="studio-panel">
          <div className="panel-head">
            <h2>Due soon</h2>
          </div>
          <p className="metric-figure">
            {
              open.filter((task) => {
                if (!task.due_at) return false;
                const due = new Date(task.due_at);
                const week = new Date();
                week.setDate(week.getDate() + 7);
                return due <= week;
              }).length
            }
          </p>
        </section>
        <section className="studio-panel">
          <div className="panel-head">
            <h2>Done</h2>
          </div>
          <p className="metric-figure">{done.length}</p>
        </section>
      </div>

      {!tasks?.length ? (
        <EmptyState
          title="No tasks yet"
          body="Capture the next concrete action so Command Center workload stays honest."
          href="#new"
          label="Add a task"
        />
      ) : (
        <section className="task-list" aria-label="Tasks">
          {tasks.map((task) => {
            const release = releases?.find((item) => item.id === task.release_id);
            return (
              <article
                className={`task-row ${task.status === "Done" ? "done" : ""}`}
                id={`task-${task.id}`}
                key={task.id}
              >
                <div>
                  <Status>{task.priority}</Status>
                  <Status>{task.status}</Status>
                  <h3>{task.title}</h3>
                  <p>
                    {release ? (
                      <Link href={`/studio/releases/${release.id}`}>
                        {release.title}
                      </Link>
                    ) : (
                      "No release"
                    )}
                    {task.due_at
                      ? ` · due ${new Intl.DateTimeFormat("en", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(task.due_at))}`
                      : " · no due date"}
                  </p>
                </div>
                <div className="task-actions">
                  {task.status !== "Done" ? (
                    <form action={completeTask}>
                      <input type="hidden" name="id" value={task.id} />
                      <button className="button">Complete</button>
                    </form>
                  ) : null}
                  <details>
                    <summary className="text-button">Edit</summary>
                    <form action={saveTask} className="studio-form">
                      <input type="hidden" name="id" value={task.id} />
                      <div className="form-grid">
                        <Field label="Title" wide>
                          <input name="title" required defaultValue={task.title} />
                        </Field>
                        <Field label="Status">
                          <select name="status" defaultValue={task.status}>
                            {TASK_STATUSES.map((status) => (
                              <option key={status}>{status}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Priority">
                          <select name="priority" defaultValue={task.priority}>
                            {TASK_PRIORITIES.map((priority) => (
                              <option key={priority}>{priority}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Release">
                          <select
                            name="release_id"
                            defaultValue={task.release_id ?? ""}
                          >
                            <option value="">No release</option>
                            {releases?.map((release) => (
                              <option key={release.id} value={release.id}>
                                {release.title}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Due">
                          <input
                            type="datetime-local"
                            name="due_at"
                            defaultValue={toLocalInput(task.due_at)}
                          />
                        </Field>
                      </div>
                      <Submit>Update task</Submit>
                    </form>
                  </details>
                  <form action={deleteStudioRecord}>
                    <input type="hidden" name="id" value={task.id} />
                    <input type="hidden" name="table" value="tasks" />
                    <button className="text-button">Delete</button>
                  </form>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <section id="new" className="studio-panel feature">
        <div className="panel-head">
          <h2>Create task</h2>
        </div>
        <form action={saveTask} className="studio-form">
          <div className="form-grid">
            <Field label="Title" wide>
              <input name="title" required placeholder="What needs to happen?" />
            </Field>
            <Field label="Status">
              <select name="status" defaultValue="Open">
                {TASK_STATUSES.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select name="priority" defaultValue="Medium">
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </Field>
            <Field label="Release">
              <select name="release_id" defaultValue={params.release ?? ""}>
                <option value="">No release</option>
                {releases?.map((release) => (
                  <option key={release.id} value={release.id}>
                    {release.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due">
              <input type="datetime-local" name="due_at" />
            </Field>
          </div>
          <Submit>Create task</Submit>
        </form>
      </section>
    </>
  );
}
