import { EmptyState, PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string }>;
}) {
  const params = await searchParams;
  const { supabase } = await requireStudioAdmin();
  const start = new Date(params.month ? `${params.month}-01` : new Date());
  start.setDate(1);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  const { data } = await supabase
    .from("content_items")
    .select("*")
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString())
    .order("scheduled_at");
  const days = Array.from(
    {
      length: new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate(),
    },
    (_, i) => i + 1,
  );
  return (
    <>
      <PageHeader
        title="Publishing calendar"
        description="A manual-first schedule. Nothing is auto-published."
        action={
          <div className="actions">
            <a className="button primary" href="/studio/content#new">
              Create content
            </a>
          </div>
        }
      />
      <div className="studio-tabs">
        <a href="?view=month">Month</a>
        <a href="?view=week">Week</a>
        <a href="?view=list">Upcoming</a>
      </div>
      {params.view === "list" ? (
        <div>
          {data?.length ? (
            data.map((item) => (
              <div className="timeline-row" key={item.id}>
                <span>
                  {item.title}
                  <br />
                  <small>{item.platform}</small>
                </span>
                <span>
                  <Status>{item.status}</Status>{" "}
                  {new Date(item.scheduled_at!).toLocaleString()}
                </span>
              </div>
            ))
          ) : (
            <EmptyState
              title="Open calendar"
              body="Date content items in the Content Lab or generate a release schedule."
            />
          )}
        </div>
      ) : (
        <div className="calendar-grid">
          {days.map((day) => (
            <div className="calendar-day" key={day}>
              <span>{day}</span>
              {data
                ?.filter(
                  (item) => new Date(item.scheduled_at!).getDate() === day,
                )
                .map((item) => (
                  <a
                    className="calendar-event"
                    href={`/studio/content?release=${item.release_id ?? ""}`}
                    key={item.id}
                  >
                    {item.title}
                    <br />
                    {item.platform}
                  </a>
                ))}
            </div>
          ))}
        </div>
      )}
      <section className="studio-panel feature">
        <div className="panel-head">
          <h2>Release schedule framework</h2>
        </div>
        <div className="identity-grid">
          {[
            ["−14 days", "Teaser and mood content"],
            ["−7 days", "Hook-testing content"],
            ["Release week", "Hero content and direct outreach"],
            ["+1 week", "Emotional context, lyrics, alternate angles"],
            ["+2 weeks", "DJ and community content"],
            ["+1 month", "Alternate edit, long-tail content, recap"],
          ].map(([date, copy]) => (
            <article key={date}>
              <h3>{date}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
