import Link from "next/link";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { contentPerformanceScore } from "@/lib/studio/performance";
import { EmptyState, PageHeader, Panel, Status } from "@/components/studio/ui";

export default async function Dashboard() {
  const { supabase } = await requireStudioAdmin();
  const today = new Date().toISOString();
  const [releases, content, followups, metrics, tasks] = await Promise.all([
    supabase
      .from("releases")
      .select("*")
      .neq("status", "Archived")
      .order("release_date", { ascending: true })
      .limit(1),
    supabase
      .from("content_items")
      .select("*")
      .order("scheduled_at", { ascending: true })
      .limit(6),
    supabase
      .from("outreach_messages")
      .select("*,outreach_contacts(name)")
      .lte("follow_up_at", today)
      .order("follow_up_at")
      .limit(6),
    supabase
      .from("metric_snapshots")
      .select("*")
      .order("date", { ascending: false })
      .limit(8),
    supabase
      .from("tasks")
      .select("*")
      .neq("status", "Done")
      .order("due_at")
      .limit(6),
  ]);
  const active = releases.data?.[0];
  const top = [...(content.data ?? [])]
    .map((item) => ({
      item,
      score: contentPerformanceScore(
        (metrics.data ?? [])
          .filter((m) => m.content_item_id === item.id)
          .reduce(
            (sum, m) =>
              Object.fromEntries(
                Object.keys(m).map((k) => [
                  k,
                  typeof m[k as keyof typeof m] === "number"
                    ? (sum[k] ?? 0) + (m[k as keyof typeof m] as number)
                    : 0,
                ]),
              ),
            {} as Record<string, number>,
          ),
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  return (
    <>
      <PageHeader
        title="Today in the studio"
        description="The clearest next moves across your active release."
        action={
          <div className="actions">
            <Link className="button primary" href="/studio/releases/new">
              New release
            </Link>
            <Link className="button" href="/studio/content#new">
              New content
            </Link>
            <Link className="button" href="/studio/outreach#new">
              New contact
            </Link>
            <Link className="button" href="/studio/analytics#new">
              Add metrics
            </Link>
          </div>
        }
      />
      <div className="studio-grid">
        {active ? (
          <Panel className="feature">
            <div className="hero-release">
              {active.artwork_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={active.artwork_url} alt="" />
              ) : (
                <div className="empty-orbit" />
              )}
              <div>
                <Status>{active.status}</Status>
                <h2>{active.title}</h2>
                <p>
                  {active.core_emotion ||
                    active.story ||
                    "Shape the identity and build the release plan."}
                </p>
                <Link
                  className="button primary"
                  href={`/studio/releases/${active.id}`}
                >
                  Open release
                </Link>
              </div>
            </div>
          </Panel>
        ) : (
          <Panel className="feature">
            <EmptyState
              title="No active release"
              body="Create the first release workspace and turn the finished track into a campaign."
              href="/studio/releases/new"
              label="Create release"
            />
          </Panel>
        )}
        <Panel title="Today's priority actions">
          {tasks.data?.length ? (
            tasks.data.map((task) => (
              <div className="list-row" key={task.id}>
                <span>
                  {task.title}
                  <br />
                  <small>{task.priority} priority</small>
                </span>
                <small>
                  {task.due_at
                    ? new Date(task.due_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Open"}
                </small>
              </div>
            ))
          ) : (
            <EmptyState
              title="Clear runway"
              body="No open tasks. Review the active release checklist for the next useful action."
            />
          )}
        </Panel>
        <Panel title="Upcoming / scheduled">
          {content.data?.filter((x) => x.scheduled_at).length ? (
            content.data
              .filter((x) => x.scheduled_at)
              .map((item) => (
                <div className="timeline-row" key={item.id}>
                  <span>
                    {item.title}
                    <br />
                    <small>
                      {item.platform} · {item.status}
                    </small>
                  </span>
                  <small>
                    {new Date(item.scheduled_at!).toLocaleDateString()}
                  </small>
                </div>
              ))
          ) : (
            <EmptyState
              title="Nothing scheduled"
              body="Build a release schedule or date content in the Content Lab."
              href="/studio/calendar"
              label="Open calendar"
            />
          )}
        </Panel>
        <Panel title="Outreach follow-ups">
          {followups.data?.length ? (
            followups.data.map((message) => (
              <div className="list-row" key={message.id}>
                <span>
                  {(message.outreach_contacts as unknown as { name: string })
                    ?.name ?? "Contact"}
                  <br />
                  <small>{message.channel}</small>
                </span>
                <Status>Due</Status>
              </div>
            ))
          ) : (
            <EmptyState
              title="No follow-ups due"
              body="Your outreach queue is clear today."
            />
          )}
        </Panel>
        <Panel title="Recent performance">
          {metrics.data?.length ? (
            <>
              <div className="metric-row">
                <span>Views</span>
                <strong>
                  {metrics.data
                    .reduce((s, m) => s + m.views, 0)
                    .toLocaleString()}
                </strong>
              </div>
              <div className="metric-row">
                <span>Profile visits</span>
                <strong>
                  {metrics.data
                    .reduce((s, m) => s + m.profile_visits, 0)
                    .toLocaleString()}
                </strong>
              </div>
              <div className="metric-row">
                <span>Follows</span>
                <strong>
                  {metrics.data
                    .reduce((s, m) => s + m.follows, 0)
                    .toLocaleString()}
                </strong>
              </div>
            </>
          ) : (
            <EmptyState
              title="No snapshots yet"
              body="Add honest manual metrics to establish a useful baseline."
              href="/studio/analytics#new"
              label="Add snapshot"
            />
          )}
        </Panel>
        <Panel title="Top content" className="feature">
          {top.length ? (
            <table className="studio-table">
              <tbody>
                {top.map(({ item, score }) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{item.platform}</td>
                    <td>
                      <Status>{item.status}</Status>
                    </td>
                    <td>{score} score</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title="Performance story pending"
              body="Published content with metric snapshots will rank here."
            />
          )}
        </Panel>
      </div>
    </>
  );
}
