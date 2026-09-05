import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { confirmArtistIdentityAction, dismissOnboardingAction } from "./actions";
import { promoteVaultTrack } from "@/app/studio/growth-actions";
import { EnsemblisMark } from "@/components/ensemblis-logo";
import { OnboardingVisitTracker } from "@/components/studio/onboarding-visit-tracker";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import type { Json } from "@/types/database";
import type { ArtistActivationEvent, OnboardingDatabase } from "@/types/onboarding-database";

type Db = SupabaseClient<OnboardingDatabase>;

type StepState = "done" | "current" | "waiting" | "future";

type ActivationStep = {
  key: string;
  label: string;
  detail: string;
  state: StepState;
};

function object(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function intelligenceReady(profile: Json) {
  const raw = object(profile);
  return raw.source === "worker" && Number(raw.version) >= 3;
}

function normalized(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function likelyBootstrapIdentity(artistName: string, email: string | null | undefined) {
  const local = String(email ?? "").split("@")[0] || "";
  return normalized(artistName) === normalized(local) || normalized(artistName) === "artist";
}

function eventMap(events: ArtistActivationEvent[]) {
  return new Map(events.map((event) => [event.event_type, event]));
}

export default async function ArtistOnboardingPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const growth = asGrowthClient(supabase);
  const music = asArtistScopedMusicClient(supabase);
  const db = supabase as unknown as Db;
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  const [vaultResult, releaseResult, momentResult, eventResult] = await Promise.all([
    growth.from("track_vault").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).neq("status", "archived").order("created_at", { ascending: true }),
    music.from("releases").select("id,title,status,release_date,created_at").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("created_at", { ascending: true }),
    db.from("moments").select("id,owner_id,artist_id,release_id,track_id,label,state,confidence,created_at").eq("owner_id", user.id).eq("artist_id", artist.artistId).in("state", ["proposed", "approved"]).order("created_at", { ascending: true }),
    db.from("artist_activation_events").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("occurred_at", { ascending: true }),
  ]);
  const firstError = [vaultResult, releaseResult, momentResult, eventResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const vault = vaultResult.data ?? [];
  const releases = releaseResult.data ?? [];
  const moments = momentResult.data ?? [];
  const events = eventMap(eventResult.data ?? []);
  const identityConfirmed = events.has("artist_identity_confirmed") || !likelyBootstrapIdentity(artist.artistName, user.email);
  const mastered = vault.filter((track) => Boolean(track.audio_url));
  const analyzed = mastered.filter((track) => intelligenceReady(track.audio_profile));
  const releaseLinkedTrack = analyzed.find((track) => Boolean(track.linked_release_id)) ?? mastered.find((track) => Boolean(track.linked_release_id)) ?? null;
  const candidate = analyzed.find((track) => !track.linked_release_id) ?? mastered.find((track) => !track.linked_release_id) ?? null;
  const mission = (releaseLinkedTrack?.linked_release_id ? releases.find((release) => release.id === releaseLinkedTrack.linked_release_id) : null) ?? releases[0] ?? null;
  const missionMoments = mission ? moments.filter((moment) => moment.release_id === mission.id) : [];
  const approvedMoments = missionMoments.filter((moment) => moment.state === "approved");
  const analysisPending = mastered.length > 0 && analyzed.length === 0;

  let current: "identity" | "music" | "analysis" | "mission" | "moments" | "complete" = "complete";
  if (!identityConfirmed) current = "identity";
  else if (!mastered.length) current = "music";
  else if (analysisPending) current = "analysis";
  else if (!mission) current = "mission";
  else if (!approvedMoments.length) current = "moments";

  const steps: ActivationStep[] = [
    { key: "identity", label: "Artist", detail: identityConfirmed ? artist.artistName : "Confirm who this workspace represents", state: identityConfirmed ? "done" : "current" },
    { key: "music", label: "Music", detail: mastered.length ? `${mastered.length} mastered track${mastered.length === 1 ? "" : "s"}` : "Add one real master", state: mastered.length ? "done" : current === "music" ? "current" : "future" },
    { key: "intelligence", label: "Understanding", detail: analyzed.length ? "Track Intelligence ready" : analysisPending ? "Ensemblis is listening" : "Automatic after upload", state: analyzed.length ? "done" : analysisPending ? "waiting" : "future" },
    { key: "mission", label: "Mission", detail: mission ? mission.title : "Turn the strongest track into a release", state: mission ? "done" : current === "mission" ? "current" : "future" },
    { key: "moment", label: "Moment", detail: approvedMoments.length ? `${approvedMoments.length} approved musical starting point${approvedMoments.length === 1 ? "" : "s"}` : missionMoments.length ? "Review the curated musical sections" : "Created from release intelligence", state: approvedMoments.length ? "done" : current === "moments" ? (missionMoments.length ? "current" : "waiting") : "future" },
  ];

  return (
    <div className="ensemblis-onboarding-shell">
      <OnboardingVisitTracker artistId={artist.artistId} />
      <header className="ensemblis-onboarding-brand">
        <span aria-hidden><EnsemblisMark /></span>
        <strong>Ensemblis</strong>
      </header>

      <main className="ensemblis-onboarding-card">
        <div className="ensemblis-onboarding-intro">
          <span className="section-label">First useful loop</span>
          <h1>{current === "complete" ? `${artist.artistName} is ready to move` : "Start with the music, not the setup"}</h1>
          <p>{current === "complete"
            ? "Ensemblis has enough real artist and music context to recommend work from the song outward."
            : "You do not need to configure providers, brand rules or automation first. Give Ensemblis one real track and it will earn the right to ask for anything else."}</p>
        </div>

        <ol className="ensemblis-onboarding-steps" aria-label="Activation progress">
          {steps.map((step) => <li className={step.state} key={step.key}><span aria-hidden>{step.state === "done" ? "✓" : ""}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></li>)}
        </ol>

        <section className="ensemblis-onboarding-action" aria-live="polite">
          {current === "identity" ? <>
            <span className="section-label">Only what we need now</span>
            <h2>What is the artist name?</h2>
            <p>The account bootstrap used <strong>{artist.artistName}</strong>. Confirm the real project identity before Ensemblis attaches music knowledge to it.</p>
            <form action={confirmArtistIdentityAction} className="ensemblis-onboarding-form">
              <input type="hidden" name="artist_id" value={artist.artistId} />
              <label>Artist name<input autoFocus required name="artist_name" defaultValue={artist.artistName === "Artist" ? "" : artist.artistName} maxLength={120} /></label>
              <label>Project type<select name="project_type" defaultValue="human"><option value="human">Human artist</option><option value="ai_assisted">Human artist using AI tools</option><option value="hybrid">Hybrid music project</option><option value="virtual_persona">Virtual / AI persona</option></select></label>
              <button className="button primary" type="submit">Use this artist</button>
            </form>
          </> : null}

          {current === "music" ? <>
            <span className="section-label">One input</span><h2>Add one mastered track</h2>
            <p>Use the actual master you care about. Title is optional. Structure, hooks, energy and useful musical sections are analyzed automatically.</p>
            <Link className="button primary" href={href("/studio/music/import?onboarding=1")}>Add mastered music</Link>
          </> : null}

          {current === "analysis" ? <>
            <span className="section-label">Working</span><h2>Ensemblis is understanding the track</h2>
            <p>You do not need to score hooks or fill in marketing fields. When Track Intelligence is ready, the release decision will appear here.</p>
            <div className="actions"><Link className="button primary" href={href("/studio/music")}>See Track Intelligence</Link><Link className="button" href={href("/studio")}>Continue elsewhere</Link></div>
          </> : null}

          {current === "mission" && candidate ? <>
            <span className="section-label">First recommendation</span><h2>Turn {candidate.title} into a Release Mission</h2>
            <p>Its Track Intelligence is ready. Starting a Mission keeps the master and analysis, creates the canonical release track and materializes the strongest reusable Moments.</p>
            <form action={promoteVaultTrack}><input type="hidden" name="id" value={candidate.id} /><button className="button primary" type="submit">Start Release Mission</button></form>
          </> : null}

          {current === "mission" && !candidate ? <>
            <span className="section-label">Music needs attention</span><h2>Open the mastered track</h2><p>Ensemblis has music but not enough current intelligence to recommend a release yet.</p><Link className="button primary" href={href("/studio/music")}>Open Music</Link>
          </> : null}

          {current === "moments" && mission && missionMoments.length ? <>
            <span className="section-label">Your judgment</span><h2>Choose the musical Moments worth using</h2>
            <p>Ensemblis curated the strongest complete sections. Approve only the parts you would actually put in front of a listener. Those decisions become authoritative downstream.</p>
            <Link className="button primary" href={href(`/studio/releases/${mission.id}`)}>Review {missionMoments.length} curated Moment{missionMoments.length === 1 ? "" : "s"}</Link>
          </> : null}

          {current === "moments" && mission && !missionMoments.length ? <>
            <span className="section-label">Working</span><h2>Curating the strongest musical sections</h2>
            <p>The Release Mission exists and its Track Intelligence is being normalized into reusable Moments. No extra setup is required.</p>
            <Link className="button primary" href={href(`/studio/releases/${mission.id}`)}>Open Release Mission</Link>
          </> : null}

          {current === "complete" ? <>
            <span className="section-label">Activated</span><h2>Choose what the music should accomplish</h2>
            <p>Your approved Moment can now drive creation, release marketing, owned attribution and learning without re-entering the same context.</p>
            <div className="actions"><Link className="button primary" href={href("/studio/create")}>Create from a Moment</Link><Link className="button" href={href("/studio")}>Go to Today</Link></div>
          </> : null}
        </section>

        {current !== "complete" ? <form action={dismissOnboardingAction} className="ensemblis-onboarding-skip"><input type="hidden" name="artist_id" value={artist.artistId} /><button type="submit">Skip the guide for now</button></form> : null}
      </main>
    </div>
  );
}