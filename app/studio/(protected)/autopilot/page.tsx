import { redirect } from "next/navigation";

export default function AutopilotPage() {
  // Autopilot is a behavior of Atlas, not a second command center. Keep the legacy
  // route as a stable redirect for bookmarks while Today owns operational decisions.
  redirect("/studio");
}
