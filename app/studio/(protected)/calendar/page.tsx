import Link from "next/link";
import { EmptyState, PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function startOfWeek(date: Date) {
  const copy = startOfDay(date);
  const day = copy.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + offset);
  return copy;
}
function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}
function sameDay(value: string, day: Date) {
  const date = new Date(value);
  return date.getFullYear() === day.getFullYear() && date.getMonth() === day.getMonth() && date.getDate() === day.getDate();
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "week" || params.view === "list" ? params.view : "month";
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const marketing = asMarketingClient(supabase);
  const anchor = params.month ? new Date(`${params.month}-01T12:00:00`) : new Date();

  let start: Date;
  let end: Date;
  let days: Date[] = [];
  if (view === "week") {
    start = startOfWeek(anchor);
    end = addDays(start, 7);
    days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  } else if (view === "list") {
    start = startOfDay(new Date());
    end = addDays(start, 30);
  } else {
    start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    const count = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    days = Array.from({ length: count }, (_, index) => new Date(anchor.getFullYear(), anchor.getMonth(), index + 1));
  }

  const { data, error } = await marketing
    .from("content_items")
    .select("*")
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString())
    .order("scheduled_at");
  if (error) throw new Error(error.message);

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Timeline"
        description={`Release-relative schedule for ${artist.artistName}. Ensemblis moves unlocked work when a release date changes; external publishing still follows approval rules.`}
        action={<Link className="button primary" href="/studio/create">Create</Link>}
      />

      <div className="studio-tabs">
        <Link className={view === "month" ? "active" : ""} href="?view=month">Month</Link>
        <Link className={view === "week" ? "active" : ""} href="?view=week">Week</Link>
        <Link className={view === "list" ? "active" : ""} href="?view=list">Next 30 days</Link>
      </div>

      {view === "list" ? (
        <div className="v2-section v2-compact-section">
          {data?.length ? data.map((item) => (
            <Link className="timeline-row" href={`/studio/production?edit=${item.id}`} key={item.id}>
              <span>{item.title}<br /><small>{item.platform}</small></span>
              <span><Status>{item.status}</Status>{" "}{new Date(item.scheduled_at!).toLocaleString()}</span>
            </Link>
          )) : <EmptyState title="Nothing scheduled" body="Ensemblis will place release-relative content here as release plans are created." />}
        </div>
      ) : (
        <div className={`calendar-grid ${view === "week" ? "v2-week-grid" : ""}`}>
          {days.map((day) => (
            <div className="calendar-day" key={day.toISOString()}>
              <span>{view === "week" ? new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(day) : day.getDate()}</span>
              {data?.filter((item) => item.scheduled_at && sameDay(item.scheduled_at, day)).map((item) => (
                <Link className="calendar-event" href={`/studio/production?edit=${item.id}`} key={item.id}>
                  {item.title}<br />{item.platform}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
