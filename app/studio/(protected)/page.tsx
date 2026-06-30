import Link from "next/link";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { contentPerformanceScore } from "@/lib/studio/performance";
import { isUnmatchedExternal } from "@/lib/studio/reconciliation";
import { EmptyState, PageHeader, Panel, Status } from "@/components/studio/ui";
import { publishStateLabel } from "@/lib/studio/catalog-labels";

export default async function Dashboard() {
  const { supabase } = await requireStudioAdmin();
  const today = new Date().toISOString();
  const [
    activeRelease,
    homepagePlacements,
    unmatchedSoundCloud,
    unmatchedSpotify,
    content,
    followups,
    metrics,
    tasks,
    mediaIssues,
  ] = await Promise.all([
    supabase
      .from("releases")
      .select("*")
      .eq("active_release", true)
      .maybeSingle(),
    supabase
      .from("homepage_placements")
      .select("*")
      .eq("enabled", true)
      .order("display_order"),
    supabase.from("soundcloud_tracks").select("*").eq("reconcile_status", "pending"),
    supabase.from("spotify_tracks").select("*").eq("reconcile_status", "pending"),
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
    supabase
      .from("releases")
      .select("id,title,artwork_url,publish_state")
      .eq("publish_state", "live")
      .is("artwork_url", null),
  ]);

  const active = activeRelease.data;
  const placementReleaseIds = (homepagePlacements.data ?? []).map((p) => p.release_id);
  const { data: homepageReleases } = placementReleaseIds.length
    ? await supabase.from("releases").select("id,title,slug,publish_state").in("id", placementReleaseIds)
    : { data: [] };
  const releaseTitleById = new Map((homepageReleases ?? []).map((release) => [release.id, release]));
  const unmatchedCount =
    (unmatchedSoundCloud.data ?? []).filter(isUnmatchedExternal).length +
    (unmatchedSpotify.data ?? []).filter(isUnmatchedExternal).length;
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
        title="Now"
        description="Active release, homepage visibility, unmatched imports, and what needs attention today."
        action={
          <div className="actions">
            <Link className="button primary" href="/studio/releases/new">
              New release
            </Link>
            <Link className="button" href="/studio/content#new">
              New content
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
                <Status>{publishStateLabel(active.publish_state)}</Status>
                <h2>{active.title}</h2>
                <p>{active.core_emotion || active.story || "Your current focus release."}</p>
                <Link className="button primary" href={`/studio/releases/${active.id}`}>
                  Open release cockpit
                </Link>
              </div>
            </div>
          </Panel>
        ) : (
          <Panel className="feature">
            <EmptyState
              title="No active release"
              body="Choose a release in Catalog and set it as the active focus."
              href="/studio/releases"
              label="Open catalog"
            />
          </Panel>
        )}

        <Panel title="Homepage player">
          {homepagePlacements.data?.length ? (
            homepagePlacements.data.map((placement) => {
              const release = releaseTitleById.get(placement.release_id);
              return (
                <div className="list-row" key={placement.id}>
                  <span>
                    {release?.title ?? "Release"}
                    <br />
                    <small>
                      {publishStateLabel(release?.publish_state ?? "draft")} · order{" "}
                      {placement.display_order}
                    </small>
                  </span>
                  <Link href={`/studio/releases/${placement.release_id}?tab=website`}>Edit</Link>
                </div>
              );
            })
          ) : (
            <EmptyState
              title="Homepage player empty"
              body="Enable homepage placement on a published release."
              href="/studio/releases"
              label="Open catalog"
            />
          )}
        </Panel>

        <Panel title="Needs attention">
          <div className="list-row">
            <span>Unmatched external tracks</span>
            <strong>{unmatchedCount}</strong>
          </div>
          <div className="list-row">
            <span>Live releases missing artwork</span>
            <strong>{mediaIssues.data?.length ?? 0}</strong>
          </div>
          {unmatchedCount > 0 && (
            <Link className="button" href="/studio/soundcloud">
              Review SoundCloud matches
            </Link>
          )}
        </Panel>

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
            <EmptyState title="Clear runway" body="No open tasks due today." />
          )}
        </Panel>

        <Panel title="Outreach follow-ups">
          {followups.data?.length ? (
            followups.data.map((message) => (
              <div className="list-row" key={message.id}>
                <span>
                  {(message.outreach_contacts as unknown as { name: string })?.name ?? "Contact"}
                  <br />
                  <small>{message.channel}</small>
                </span>
                <Status>Due</Status>
              </div>
            ))
          ) : (
            <EmptyState title="No follow-ups due" body="Your outreach queue is clear today." />
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
                  <small>{new Date(item.scheduled_at!).toLocaleDateString()}</small>
                </div>
              ))
          ) : (
            <EmptyState
              title="Nothing scheduled"
              body="Build a release schedule in Content or Calendar."
              href="/studio/calendar"
              label="Open calendar"
            />
          )}
        </Panel>

        <Panel title="Recent performance">
          {metrics.data?.length ? (
            <>
              <div className="metric-row">
                <span>Views</span>
                <strong>{metrics.data.reduce((s, m) => s + m.views, 0).toLocaleString()}</strong>
              </div>
              <div className="metric-row">
                <span>Streams</span>
                <strong>{metrics.data.reduce((s, m) => s + m.streams, 0).toLocaleString()}</strong>
              </div>
            </>
          ) : (
            <EmptyState
              title="No snapshots yet"
              body="Add metrics in Insights."
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
                    <td>{score} score</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="Performance story pending" body="Published content will rank here." />
          )}
        </Panel>
      </div>
    </>
  );
}
