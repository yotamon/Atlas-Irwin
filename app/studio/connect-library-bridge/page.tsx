import { redirect } from "next/navigation";
import { LibraryBridgeConnect } from "@/components/studio/library-bridge-connect";
import { studioReturnPath } from "@/lib/auth/studio-return-path";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";

export const dynamic = "force-dynamic";

type Params = { callback?: string; state?: string };

export default async function ConnectLibraryBridgePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const requested = `/studio/connect-library-bridge?callback=${encodeURIComponent(params.callback ?? "")}&state=${encodeURIComponent(params.state ?? "")}`;
  const safeReturnPath = studioReturnPath(requested);
  if (safeReturnPath === "/studio") redirect("/studio");

  const safeUrl = new URL(safeReturnPath, "https://ensemblis.invalid");
  const callbackUrl = safeUrl.searchParams.get("callback") ?? "";
  const state = safeUrl.searchParams.get("state") ?? "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect(`/studio/login?next=${encodeURIComponent(safeReturnPath)}`);

  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", data.user.id).maybeSingle();
  if (!profile?.is_admin) redirect("/studio/access-denied");
  const artist = await resolveActiveArtistContext(supabase, data.user);

  return <LibraryBridgeConnect artistId={artist.artistId} artistName={artist.artistName} callbackUrl={callbackUrl} state={state} />;
}
