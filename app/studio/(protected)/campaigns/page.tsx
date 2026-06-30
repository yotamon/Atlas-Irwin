/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";

function monthDays(anchor: Date) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ view?: string; release?: string; platform?: string; status?: string; type?: string }> }) {
  const params = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const [releasesResult, tracksResult, contentResult, outreachResult, assetsResult] = await Promise.all([
    supabase.from("releases").select("*").eq("owner_id", user.id).order("release_date", { ascending: false }),
    supabase.from("tracks").select("id,title,release_id").eq("owner_id", user.id),
    supabase.from("content_items").select("*").eq("owner_id", user.id).order("scheduled_at", { ascending: true }),
    supabase.from("outreach_messages").select("*,outreach_contacts(name)").eq("owner_id", user.id).order("follow_up_at"),
    supabase.from("media_links").select("release_id,content_item_id,media_asset_id").eq("owner_id", user.id),
  ]);
  const releases = releasesResult.data ?? [];
  const tracks = tracksResult.data ?? [];
  const outreach = outreachResult.data ?? [];
  const assetLinks = assetsResult.data ?? [];
  let content = contentResult.data ?? [];
  if (params.release) content = content.filter((item) => item.release_id === params.release);
  if (params.platform) content = content.filter((item) => item.platform === params.platform);
  if (params.status) content = content.filter((item) => item.status === params.status);
  if (params.type) content = content.filter((item) => item.format === params.type);
  const activeCampaigns = releases.map((release) => {
    const items = contentResult.data?.filter((item) => item.release_id === release.id) ?? [];
    const messages = outreach.filter((message) => message.release_id === release.id);
    const linkedAssets = assetLinks.filter((link) => link.release_id === release.id || (link.content_item_id && items.some((item) => item.id === link.content_item_id)));
    return { release, items, messages, linkedAssets };
  }).filter((campaign) => campaign.items.length || campaign.messages.length || campaign.release.active_release);
  const anchor = new Date();
  const days = monthDays(anchor);

  return (
    <>
      <PageHeader title="Campaigns" description="Release momentum, catalog revivals, content, and outreach in one workload." action={<Link className="button primary" href="/studio/content#new">Create content item</Link>} />
      <section className="campaign-summary-rail" aria-label="Campaign overview">
        {activeCampaigns.length ? activeCampaigns.map(({ release, items, messages, linkedAssets }) => {
          const published = items.filter((item) => item.status === "Published").length;
          const scheduled = items.filter((item) => item.status === "Scheduled").length;
          return <Link href={`/studio/releases/${release.id}?tab=campaign`} className="campaign-summary" key={release.id}>{release.artwork_url ? <img src={release.artwork_url} alt="" /> : <span className="campaign-artwork-empty" />}<div><span className="section-label">{release.active_release ? "Active campaign" : "Release campaign"}</span><h2>{release.title}</h2><p>{release.primary_hook || release.core_emotion || "Define the campaign goal inside the release workspace."}</p><dl><div><dt>Content</dt><dd>{items.length}</dd></div><div><dt>Scheduled</dt><dd>{scheduled}</dd></div><div><dt>Published</dt><dd>{published}</dd></div><div><dt>Outreach</dt><dd>{messages.length}</dd></div><div><dt>Assets</dt><dd>{linkedAssets.length}</dd></div></dl></div></Link>;
        }) : <div className="empty-state"><h3>No campaign is in motion</h3><p>Open a release workspace and add the first content action.</p></div>}
      </section>

      <div className="campaign-controls">
        <form>
          <input type="hidden" name="view" value={params.view ?? "list"} />
          <select name="release" defaultValue={params.release ?? ""} aria-label="Filter by release"><option value="">All releases</option>{releases.map((release) => <option key={release.id} value={release.id}>{release.title}</option>)}</select>
          <select name="platform" defaultValue={params.platform ?? ""} aria-label="Filter by platform"><option value="">All platforms</option>{[...new Set((contentResult.data ?? []).map((item) => item.platform))].map((platform) => <option key={platform} value={platform}>{platform}</option>)}</select>
          <select name="status" defaultValue={params.status ?? ""} aria-label="Filter by status"><option value="">All statuses</option>{["Idea", "Draft", "In Production", "Ready", "Scheduled", "Published", "Archived"].map((status) => <option key={status}>{status}</option>)}</select>
          <select name="type" defaultValue={params.type ?? ""} aria-label="Filter by content type"><option value="">All content types</option>{[...new Set((contentResult.data ?? []).map((item) => item.format))].map((format) => <option key={format} value={format}>{format}</option>)}</select>
          <button className="button">Apply</button>
        </form>
        <div className="view-toggle"><Link className={params.view !== "calendar" ? "active" : undefined} href={{ query: { ...params, view: "list" } }}>List</Link><Link className={params.view === "calendar" ? "active" : undefined} href={{ query: { ...params, view: "calendar" } }}>Calendar</Link></div>
      </div>

      {params.view === "calendar" ? (
        <section className="campaign-calendar" aria-label={`${anchor.toLocaleString("en", { month: "long", year: "numeric" })} campaign calendar`}>
          <header><h2>{anchor.toLocaleString("en", { month: "long", year: "numeric" })}</h2><p>Scheduled content and follow-up workload</p></header>
          <div className="calendar-grid">
            {days.map((day) => {
              const dateKey = day.toISOString().slice(0, 10);
              const events = content.filter((item) => item.scheduled_at?.slice(0, 10) === dateKey);
              const followups = outreach.filter((item) => item.follow_up_at?.slice(0, 10) === dateKey);
              return <div className={`calendar-day ${day.getMonth() !== anchor.getMonth() ? "outside" : ""}`} key={dateKey}><span>{day.getDate()}</span>{events.map((event) => <Link className="calendar-event" href={`/studio/content?edit=${event.id}`} key={event.id}>{event.title}<small>{event.platform}</small></Link>)}{followups.map((followup) => <Link className="calendar-event outreach" href={`/studio/outreach/${followup.contact_id}`} key={followup.id}>Follow-up<small>{followup.channel}</small></Link>)}</div>;
            })}
          </div>
        </section>
      ) : (
        <section className="campaign-list" aria-label="Campaign content">
          <div className="campaign-list-head"><span>Date</span><span>Content / release</span><span>Platform</span><span>Objective</span><span>Asset</span><span>Status</span></div>
          {content.length ? content.map((item) => {
            const release = releases.find((entry) => entry.id === item.release_id);
            const hasAsset = Boolean(item.asset_url || assetLinks.some((link) => link.content_item_id === item.id));
            return <Link className="campaign-list-row" href={`/studio/content?edit=${item.id}`} key={item.id}><time>{item.scheduled_at ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(item.scheduled_at)) : "Unscheduled"}</time><span><strong>{item.title}</strong><small>{release?.title || "Catalog moment"}{tracks.some((track) => item.caption?.includes(track.title)) ? " · linked track in caption" : ""}</small></span><span>{item.platform}<small>{item.format}</small></span><span>{item.goal}</span><span className={hasAsset ? "asset-ready" : "asset-missing"}>{hasAsset ? "Ready" : "Missing"}</span><Status>{item.status}</Status></Link>;
          }) : <div className="empty-state"><h3>No content matches these filters</h3><p>Adjust the view or create the next deliberate campaign action.</p></div>}
        </section>
      )}
    </>
  );
}
