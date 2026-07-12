import Link from "next/link";
import {
  deleteStudioRecord,
  saveLearning,
  saveMetric,
} from "@/app/studio/actions";
import { Sparkline } from "@/components/studio/sparkline";
import {
  EmptyState,
  Field,
  PageHeader,
  Panel,
  Submit,
} from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { PLATFORMS } from "@/lib/studio/constants";
import {
  contentPerformanceScore,
  conversionPercent,
  DEFAULT_PERFORMANCE_WEIGHTS,
  deltaLabel,
  metricTotal,
  PULSE_METRICS,
  seriesByDate,
} from "@/lib/studio/performance";

export default async function AnalyticsPage() {
  const { supabase, user } = await requireStudioAdmin();
  const now = new Date();
  const lookback = new Date(now);
  lookback.setDate(now.getDate() - 28);
  const [
    { data: metrics },
    { data: releases },
    { data: content },
    { data: learnings },
  ] = await Promise.all([
    supabase
      .from("metric_snapshots")
      .select("*")
      .eq("owner_id", user.id)
      .order("date", { ascending: false }),
    supabase.from("releases").select("id,title").eq("owner_id", user.id),
    supabase
      .from("content_items")
      .select("id,title,format,platform")
      .eq("owner_id", user.id),
    supabase
      .from("release_learnings")
      .select("*,releases(title)")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const rows = metrics ?? [];
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - 7);
  const previousWeekStart = new Date(now);
  previousWeekStart.setDate(now.getDate() - 14);
  const currentMetrics = rows.filter(
    (row) => new Date(`${row.date}T12:00:00`) >= thisWeekStart,
  );
  const previousMetrics = rows.filter((row) => {
    const date = new Date(`${row.date}T12:00:00`);
    return date >= previousWeekStart && date < thisWeekStart;
  });

  const ranked = (content ?? [])
    .map((item) => {
      const agg = rows
        .filter((m) => m.content_item_id === item.id)
        .reduce(
          (a, m) => {
            Object.keys(DEFAULT_PERFORMANCE_WEIGHTS).forEach(
              (k) =>
                (a[k] = (a[k] ?? 0) + (Number(m[k as keyof typeof m]) || 0)),
            );
            return a;
          },
          {} as Record<string, number>,
        );
      return { ...item, score: contentPerformanceScore(agg), metrics: agg };
    })
    .sort((a, b) => b.score - a.score);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Manual snapshots that turn performance into creative decisions."
      />
      <div className="studio-grid analytics-pulse">
        {PULSE_METRICS.map(([key, label]) => {
          const current = metricTotal(currentMetrics, key);
          const previous = metricTotal(previousMetrics, key);
          const series = seriesByDate(rows, key, 14).map((point) => point.value);
          return (
            <Panel title={label} key={key} className="analytics-metric">
              <strong className="metric-figure">{current.toLocaleString()}</strong>
              <small className={current >= previous ? "positive" : "negative"}>
                {deltaLabel(current, previous)}
              </small>
              <Sparkline values={series} label={label} />
            </Panel>
          );
        })}
      </div>

      <div className="signal-strip analytics-signals" aria-label="Weekly conversion signals">
        <div>
          <span>View → save</span>
          <strong>
            {conversionPercent(
              metricTotal(currentMetrics, "saves"),
              metricTotal(currentMetrics, "views"),
            )}
          </strong>
        </div>
        <div>
          <span>Visit → follow</span>
          <strong>
            {conversionPercent(
              metricTotal(currentMetrics, "follows"),
              metricTotal(currentMetrics, "profile_visits"),
            )}
          </strong>
        </div>
        <div>
          <span>View → click</span>
          <strong>
            {conversionPercent(
              metricTotal(currentMetrics, "link_clicks"),
              metricTotal(currentMetrics, "views"),
            )}
          </strong>
        </div>
      </div>

      <section className="studio-panel feature">
        <div className="panel-head">
          <h2>Content performance</h2>
        </div>
        {ranked.some((x) => x.score) ? (
          <table className="studio-table">
            <thead>
              <tr>
                <th>Content</th>
                <th>Format</th>
                <th>Platform</th>
                <th>Weighted score</th>
              </tr>
            </thead>
            <tbody>
              {ranked
                .filter((x) => x.score)
                .map((x) => (
                  <tr key={x.id}>
                    <td>
                      <Link href={`/studio/content?edit=${x.id}`}>{x.title}</Link>
                    </td>
                    <td>{x.format}</td>
                    <td>{x.platform}</td>
                    <td>{x.score}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title="No ranked content yet"
            body="Link metric snapshots to content items to reveal the best hooks, formats, and platforms."
          />
        )}
        <p>
          <small>
            Score = follows × 10 + profile visits × 8 + saves × 8 + link clicks
            × 6 + shares × 5 + watch time × 0.02 + likes × 1 + views × 0.05.
            Weights live in lib/studio/performance.ts.
          </small>
        </p>
      </section>
      <section id="new" className="studio-panel feature">
        <div className="panel-head">
          <h2>Add metric snapshot</h2>
        </div>
        <form action={saveMetric} className="studio-form">
          <div className="form-grid">
            <Field label="Date">
              <input
                type="date"
                name="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </Field>
            <Field label="Platform">
              <select name="platform">
                {PLATFORMS.filter((x) => x !== "Other").map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Release">
              <select name="release_id">
                <option value="">None</option>
                {releases?.map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Content item">
              <select name="content_item_id">
                <option value="">None</option>
                {content?.map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </Field>
            {[
              "reach",
              "views",
              "watch_time",
              "likes",
              "comments",
              "shares",
              "saves",
              "profile_visits",
              "follows",
              "link_clicks",
              "streams",
              "listeners",
              "playlist_adds",
            ].map((key) => (
              <Field label={key.replaceAll("_", " ")} key={key}>
                <input type="number" min="0" name={key} defaultValue="0" />
              </Field>
            ))}
            <Field label="Notes" wide>
              <textarea name="notes" />
            </Field>
          </div>
          <Submit>Save snapshot</Submit>
        </form>
      </section>
      <section className="studio-panel feature">
        <div className="panel-head">
          <h2>Release learnings</h2>
        </div>
        {learnings?.length ? (
          learnings.map((l) => <blockquote key={l.id}>{l.learning}</blockquote>)
        ) : (
          <EmptyState
            title="No conclusions saved"
            body="Turn repeated signals into concise creative principles for the next release."
          />
        )}
        <form action={saveLearning} className="studio-form">
          <div className="form-grid">
            <Field label="Release">
              <select name="release_id" required>
                <option value="">Select release</option>
                {releases?.map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Learning">
              <input
                name="learning"
                required
                placeholder="What should the next release remember?"
              />
            </Field>
          </div>
          <Submit>Save learning</Submit>
        </form>
      </section>
      {rows.length ? (
        <section className="studio-panel feature">
          <div className="panel-head">
            <h2>Snapshot history</h2>
          </div>
          <table className="studio-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Platform</th>
                <th>Views</th>
                <th>Follows</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.date}</td>
                  <td>{m.platform}</td>
                  <td>{m.views}</td>
                  <td>{m.follows}</td>
                  <td>
                    <details>
                      <summary>Edit</summary>
                      <form action={saveMetric} className="studio-form">
                        <input type="hidden" name="id" value={m.id} />
                        <input
                          type="hidden"
                          name="release_id"
                          value={m.release_id ?? ""}
                        />
                        <input
                          type="hidden"
                          name="content_item_id"
                          value={m.content_item_id ?? ""}
                        />
                        <input type="hidden" name="date" value={m.date} />
                        <input
                          type="hidden"
                          name="platform"
                          value={m.platform}
                        />
                        {[
                          "reach",
                          "views",
                          "watch_time",
                          "likes",
                          "comments",
                          "shares",
                          "saves",
                          "profile_visits",
                          "follows",
                          "link_clicks",
                          "streams",
                          "listeners",
                          "playlist_adds",
                        ].map((key) => (
                          <Field label={key.replaceAll("_", " ")} key={key}>
                            <input
                              type="number"
                              min="0"
                              name={key}
                              defaultValue={
                                Number(m[key as keyof typeof m]) || 0
                              }
                            />
                          </Field>
                        ))}
                        <input
                          type="hidden"
                          name="notes"
                          value={m.notes ?? ""}
                        />
                        <Submit>Update</Submit>
                      </form>
                    </details>
                    <form action={deleteStudioRecord}>
                      <input type="hidden" name="id" value={m.id} />
                      <input
                        type="hidden"
                        name="table"
                        value="metric_snapshots"
                      />
                      <button className="text-button">Delete</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}
