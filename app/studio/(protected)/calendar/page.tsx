import { redirect } from "next/navigation";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  query.set("view", params.view === "list" ? "list" : "calendar");
  if (params.month) query.set("month", params.month);
  redirect(`/studio/campaigns?${query.toString()}`);
}
