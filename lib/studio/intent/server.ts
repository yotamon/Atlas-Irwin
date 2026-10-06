import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { runEnsemblisAiTask } from "@/lib/ai/control-plane";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { releaseLifecycle } from "@/lib/marketing/release-lifecycle";
import type { ArtistContext } from "@/lib/studio/artist-context";
import { loadArtistOperatingSnapshot } from "@/lib/studio/artist-operating-snapshot";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { deriveReleaseMission } from "@/lib/studio/release-mission";
import { loadReleaseWorkspaceSnapshot } from "@/lib/studio/release-workspace";
import type { AutoMixDatabase, AutoMixJob } from "@/types/automix-database";
import type { Database, MetricSnapshot } from "@/types/database";
import {
  classifyStudioIntent,
  semanticIntentSchema,
  type ClassifiedStudioIntent,
  type StudioIntentKind,
  type StudioIntentObjectType,
} from "./domain";

export type StudioIntentResult = {
  id: string;
  resultType: "action" | "object" | "answer";
  label: string;
  detail: string;
  href: string;
  eyebrow?: string;
  primary?: boolean;
};

export type StudioIntentResolution = {
  intent: ClassifiedStudioIntent;
  results: StudioIntentResult[];
  usedSemanticFallback: boolean;
};

type TrackCandidate = {
  id: string;
  title: string;
  status: string;
  version: string | null;
  linked_track_id: string | null;
  linked_release_id: string | null;
  audio_url: string | null;
};

type ReleaseCandidate = {
  id: string;
  title: string;
  status: string;
  release_type: string;
  release_date: string | null;
};

function pattern(value: string) {
  return `%${value.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mixRoot(job: AutoMixJob) {
  const lineage = asRecord(asRecord(job.request_payload).plan_lineage);
  return typeof lineage.root_job_id === "string" ? lineage.root_job_id : job.id;
}

function mixSource(job: AutoMixJob) {
  return asRecord(job.request_payload).execution_target === "device" ? "local" : "catalog";
}

function chooseByLabel<T extends { title?: string; name?: string }>(items: T[], query: string) {
  if (!items.length) return null;
  if (!query) return items[0] ?? null;
  const normalized = query.toLowerCase().trim();
  return items.find((item) => (item.title ?? item.name ?? "").toLowerCase().trim() === normalized)
    ?? (items.length === 1 ? items[0] : null);
}

function total(rows: MetricSnapshot[], key: keyof MetricSnapshot) {
  return rows.reduce((sum, row) => sum + (typeof row[key] === "number" ? Number(row[key]) : 0), 0);
}

async function semanticIntent(input: {
  ownerId: string;
  artistId: string;
  query: string;
}): Promise<ClassifiedStudioIntent | null> {
  try {
    const result = await runEnsemblisAiTask<{
      kind: StudioIntentKind;
      objectType: StudioIntentObjectType;
      objectQuery: string;
      desiredOutcome: string | null;
      createMode?: "static" | "motion" | null;
    }>({
      ownerId: input.ownerId,
      artistId: input.artistId,
      task: "ux.intent_resolution",
      purpose: "studio_intent_resolution",
      promptVersion: "ux-v5-intent-v1",
      schema: semanticIntentSchema(),
      instructions: [
        "Classify one Ensemblis Studio user request into the provided intent schema.",
        "Resolve only the user's intended product action and the object words they supplied.",
        "Do not invent track or release names. Keep objectQuery empty when no object is named.",
        "Use create_from_object for requests to make a reel, clip, post, visualizer, artwork or other creative from music.",
        "For visual create requests, set createMode=static for cover-to-social artwork and createMode=motion for animation, looping artwork or a visualizer.",
        "Use prepare_release for getting a release ready or preparing it for distribution.",
        "Use release_readiness for questions asking whether a release is ready.",
        "Use release_results for questions asking how a release is performing.",
        "Use today_priority when the artist asks what to work on, what matters now, or what the next move is.",
        "Use mix_music for requests to make a DJ mix or set, including when a source track is named.",
        "Use open_object when the request is mainly to find/open something.",
        "Return unknown if the request is unrelated to supported Studio work.",
      ].join(" "),
      input: input.query,
      inputContext: { surface: "action_launcher", rawQueryStored: false },
      cacheMode: "use",
    });
    return {
      ...result.value,
      objectQuery: result.value.objectQuery.trim(),
      desiredOutcome: result.value.desiredOutcome?.trim() || null,
      confidence: "medium",
      source: "semantic",
    };
  } catch {
    return null;
  }
}

async function searchTracks(db: SupabaseClient<Database>, ownerId: string, artistId: string, query: string) {
  const growth = asGrowthClient(db);
  let request = growth.from("track_vault")
    .select("id,title,status,version,linked_track_id,linked_release_id,audio_url")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .neq("status", "archived");
  if (query) request = request.ilike("title", pattern(query));
  const result = await request.order("updated_at", { ascending: false }).limit(6);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as TrackCandidate[];
}

async function searchReleases(db: SupabaseClient<Database>, ownerId: string, artistId: string, query: string) {
  const music = asArtistScopedMusicClient(db);
  let request = music.from("releases")
    .select("id,title,status,release_type,release_date")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId);
  if (query) request = request.ilike("title", pattern(query));
  const result = await request.order("updated_at", { ascending: false }).limit(6);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as ReleaseCandidate[];
}

async function searchMixes(db: SupabaseClient<Database>, ownerId: string, artistId: string, query: string) {
  const automix = db as unknown as SupabaseClient<AutoMixDatabase>;
  let request = automix.from("automix_jobs")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId);
  if (query) request = request.ilike("name", pattern(query));
  const result = await request.order("updated_at", { ascending: false }).limit(12);
  if (result.error) throw new Error(result.error.message);
  const seen = new Set<string>();
  return (result.data ?? []).filter((job) => {
    const root = mixRoot(job);
    if (seen.has(root)) return false;
    seen.add(root);
    return true;
  }).slice(0, 6);
}

function directResult(kind: StudioIntentKind, artistId: string): StudioIntentResult[] {
  const href = (path: string) => ensemblisArtistHref(path, artistId);
  if (kind === "add_music") return [{
    id: "intent:add-music",
    resultType: "action",
    eyebrow: "Do this",
    label: "Add music",
    detail: "Bring in a mastered track or release.",
    href: href("/studio/music?view=add"),
    primary: true,
  }];
  if (kind === "needs_you") return [{
    id: "intent:needs-you",
    resultType: "action",
    eyebrow: "Needs you",
    label: "Review decisions",
    detail: "Only decisions and approvals that require your judgment.",
    href: href("/studio/needs-you"),
    primary: true,
  }];
  if (kind === "connect_library") return [{
    id: "intent:connect-library",
    resultType: "action",
    eyebrow: "Connect",
    label: "Connect your music library",
    detail: "Pair this computer and use local music without uploading it.",
    href: href("/studio/connect-library-bridge"),
    primary: true,
  }];
  if (kind === "mix_music") return [{
    id: "intent:new-mix",
    resultType: "action",
    eyebrow: "Do this",
    label: "Make a DJ mix",
    detail: "Choose music, shape the set, review transitions and render.",
    href: href("/studio/music/automix"),
    primary: true,
  }];
  if (kind === "prepare_release") return [{
    id: "intent:new-release",
    resultType: "action",
    eyebrow: "Do this",
    label: "Prepare a release",
    detail: "Start a release plan and keep its music, creative and distribution together.",
    href: href("/studio/releases/new"),
    primary: true,
  }];
  return [];
}

function actionForTrack(intent: ClassifiedStudioIntent, track: TrackCandidate, artistId: string): StudioIntentResult {
  const href = (path: string) => ensemblisArtistHref(path, artistId);
  if (intent.kind === "master_track") {
    return {
      id: `intent:master:${track.id}`,
      resultType: "action",
      eyebrow: "Master",
      label: `Master ${track.title}`,
      detail: track.audio_url ? "Open the mastering check and the next useful mastering action." : "Add the canonical master before mastering can begin.",
      href: track.audio_url ? href(`/studio/music/${track.id}#mastering`) : href("/studio/music?view=add"),
      primary: true,
    };
  }
  if (intent.kind === "create_from_object") {
    if (intent.desiredOutcome === "visual" && track.linked_release_id) {
      const mode = intent.createMode ? `&mode=${encodeURIComponent(intent.createMode)}` : "";
      return {
        id: `intent:create-visual:${track.id}`,
        resultType: "action",
        eyebrow: intent.createMode === "motion" ? "Animate" : "Create",
        label: intent.createMode === "motion" ? `Animate artwork for ${track.title}` : `Create a release visual for ${track.title}`,
        detail: intent.createMode === "motion"
          ? "Start from the approved release visual identity, then continue into Living Artwork."
          : "Turn the release artwork into a polished static social visual without requiring a musical Moment.",
        href: href(`/studio/create?release=${track.linked_release_id}&outcome=visual${mode}`),
        primary: true,
      };
    }
    if (!track.linked_track_id) {
      return {
        id: `intent:create-needs-release-context:${track.id}`,
        resultType: "action",
        eyebrow: "Prepare source",
        label: `Open ${track.title}`,
        detail: "Creative work needs release-track context and approved sections. Open the track to finish that context without losing the source you chose.",
        href: href(`/studio/music/${track.id}`),
        primary: true,
      };
    }
    const outcome = intent.desiredOutcome ? `&outcome=${encodeURIComponent(intent.desiredOutcome)}` : "";
    return {
      id: `intent:create:${track.id}`,
      resultType: "action",
      eyebrow: "Create",
      label: `Create from ${track.title}`,
      detail: intent.desiredOutcome ? `Start with this track and make a ${intent.desiredOutcome}.` : "Start with this track's strongest usable section.",
      href: href(`/studio/create?track=${track.linked_track_id}${outcome}`),
      primary: true,
    };
  }
  if (intent.kind === "mix_music") {
    return {
      id: `intent:mix:${track.id}`,
      resultType: "action",
      eyebrow: "Mix",
      label: `Start a mix${track.linked_track_id ? ` with ${track.title}` : ""}`,
      detail: track.linked_track_id
        ? "Use this track as the starting source for a new DJ mix."
        : "This unreleased master is not yet part of the catalog track set. Open AutoMix and choose available catalog or local music without pretending this source was preselected.",
      href: track.linked_track_id
        ? href(`/studio/music/automix?track=${encodeURIComponent(track.linked_track_id)}`)
        : href("/studio/music/automix"),
      primary: true,
    };
  }
  return {
    id: `track:${track.id}`,
    resultType: "object",
    eyebrow: "Track",
    label: track.title,
    detail: `${track.status.replaceAll("_", " ")}${track.version ? ` · ${track.version}` : ""}`,
    href: href(`/studio/music/${track.id}`),
    primary: true,
  };
}

function actionForRelease(intent: ClassifiedStudioIntent, release: ReleaseCandidate, artistId: string): StudioIntentResult {
  const href = (path: string) => ensemblisArtistHref(path, artistId);
  if (intent.kind === "promote_release") {
    return {
      id: `intent:promote:${release.id}`,
      resultType: "action",
      eyebrow: "Promote",
      label: `Promote ${release.title}`,
      detail: "Open this release's promotion plan and next growth action.",
      href: href(`/studio/releases/${release.id}?stage=promotion`),
      primary: true,
    };
  }
  if (intent.kind === "create_from_object") {
    const outcome = intent.desiredOutcome ? `&outcome=${encodeURIComponent(intent.desiredOutcome)}` : "";
    const mode = intent.createMode ? `&mode=${encodeURIComponent(intent.createMode)}` : "";
    const visual = intent.desiredOutcome === "visual";
    return {
      id: `intent:create-release:${release.id}`,
      resultType: "action",
      eyebrow: visual && intent.createMode === "motion" ? "Animate" : "Create",
      label: visual
        ? intent.createMode === "motion"
          ? `Animate artwork for ${release.title}`
          : `Create a release visual for ${release.title}`
        : `Create for ${release.title}`,
      detail: visual
        ? intent.createMode === "motion"
          ? "Start from the approved release visual identity, then continue into Living Artwork."
          : "Turn the release artwork into a polished Story or feed visual before deciding whether it needs motion."
        : intent.desiredOutcome
          ? `Use the strongest musical source and make a ${intent.desiredOutcome}.`
          : "Use the strongest approved musical source for this release.",
      href: href(`/studio/create?release=${release.id}${outcome}${mode}`),
      primary: true,
    };
  }
  if (intent.kind === "prepare_release" || intent.kind === "continue_work") {
    return {
      id: `intent:prepare:${release.id}`,
      resultType: "action",
      eyebrow: "Release",
      label: `Continue ${release.title}`,
      detail: "Open the current release state, blocker and next useful action.",
      href: href(`/studio/releases/${release.id}`),
      primary: true,
    };
  }
  return {
    id: `release:${release.id}`,
    resultType: "object",
    eyebrow: "Release",
    label: release.title,
    detail: `${release.release_type} · ${release.status}`,
    href: href(`/studio/releases/${release.id}`),
    primary: true,
  };
}

async function releaseAnswer(input: {
  db: SupabaseClient<Database>;
  ownerId: string;
  artist: ArtistContext;
  release: ReleaseCandidate;
  intent: ClassifiedStudioIntent;
}) {
  const snapshot = await loadReleaseWorkspaceSnapshot({
    db: input.db,
    ownerId: input.ownerId,
    artist: input.artist,
    releaseId: input.release.id,
    advanced: false,
    tab: "overview",
  });
  const href = (path: string) => ensemblisArtistHref(path, input.artist.artistId);

  if (input.intent.kind === "release_results") {
    const streams = total(snapshot.metrics, "streams");
    const listeners = total(snapshot.metrics, "listeners");
    const saves = total(snapshot.metrics, "saves");
    const hasSignal = streams > 0 || listeners > 0 || saves > 0;
    return {
      id: `intent:results:${input.release.id}`,
      resultType: "answer" as const,
      eyebrow: "Release results",
      label: input.release.title,
      detail: hasSignal
        ? `${streams.toLocaleString()} streams · ${listeners.toLocaleString()} listeners · ${saves.toLocaleString()} saves. Open Results for the interpretation and next action.`
        : "No meaningful listening evidence is available yet. Open Results to see what Ensemblis can infer and what to measure next.",
      href: href(`/studio/releases/${input.release.id}?stage=results`),
      primary: true,
    };
  }

  const vaultByTrack = new Map(snapshot.vaultTracks.filter((vault) => vault.linked_track_id).map((vault) => [vault.linked_track_id as string, vault]));
  const legacySingleVault = snapshot.tracks.length === 1 ? snapshot.vaultTracks.find((vault) => !vault.linked_track_id) ?? null : null;
  const mastersReady = snapshot.tracks.filter((track) => Boolean(track.audio_url || vaultByTrack.get(track.id)?.audio_url || legacySingleVault?.audio_url)).length;
  const now = Date.now();
  const missingAssetTitles = snapshot.contentItems
    .filter((item) => item.scheduled_at && Date.parse(item.scheduled_at) >= now - 3_600_000 && !item.asset_url && item.status !== "Published")
    .map((item) => item.title);
  const lifecycle = releaseLifecycle({
    releaseDate: snapshot.release.release_date,
    status: snapshot.release.status,
    isArchived: snapshot.release.is_archived,
  });
  const mission = deriveReleaseMission({
    releaseId: snapshot.release.id,
    lifecycle,
    releaseDate: snapshot.release.release_date,
    hasMasterAudio: snapshot.tracks.length > 0 && mastersReady === snapshot.tracks.length,
    hasArtwork: Boolean(snapshot.release.artwork_url || snapshot.release.cover_asset),
    hasCampaign: Boolean(snapshot.campaign),
    missingAssetTitles,
    hasListeningDestination: Boolean(snapshot.release.smart_link_url || snapshot.release.spotify_url || snapshot.release.soundcloud_url || snapshot.release.youtube_url),
    hasPrimaryHook: Boolean(snapshot.release.primary_hook),
    providerScheduledCount: snapshot.providerScheduledCount,
  });
  const next = mission.nextAction;
  return {
    id: `intent:readiness:${input.release.id}`,
    resultType: "answer" as const,
    eyebrow: "Release readiness",
    label: `${input.release.title}: ${mission.label}`,
    detail: next ? `${mission.summary} Next: ${next.title}.` : mission.summary,
    href: next ? href(next.href) : href(`/studio/releases/${input.release.id}`),
    primary: true,
  };
}

async function todayPriorityAnswer(input: {
  db: SupabaseClient<Database>;
  ownerId: string;
  artist: ArtistContext;
}): Promise<StudioIntentResult> {
  const snapshot = await loadArtistOperatingSnapshot({
    db: input.db,
    userId: input.ownerId,
    artist: input.artist,
  });
  const href = (path: string) => ensemblisArtistHref(path, input.artist.artistId);
  const handsOff = snapshot.operatingContext.profile.marketingInvolvement === "just_make_music";

  if (snapshot.topDecision) {
    return {
      id: "intent:today-priority:decision",
      resultType: "answer",
      eyebrow: "Best next move",
      label: snapshot.topDecision.title,
      detail: snapshot.topDecision.detail,
      href: href(snapshot.topDecision.href),
      primary: true,
    };
  }

  const missionAction = handsOff ? null : snapshot.primaryMission?.nextAction ?? null;
  if (missionAction) {
    return {
      id: "intent:today-priority:mission",
      resultType: "answer",
      eyebrow: "Best next move",
      label: missionAction.title,
      detail: snapshot.primaryMission?.summary || missionAction.title,
      href: href(missionAction.href),
      primary: true,
    };
  }

  const next = handsOff ? snapshot.humanNextAction : snapshot.nextAction;
  const nextHref = handsOff ? snapshot.humanNextActionHref : snapshot.nextActionHref;
  if (next && nextHref) {
    return {
      id: "intent:today-priority:action",
      resultType: "answer",
      eyebrow: "Best next move",
      label: next.title,
      detail: next.rationale,
      href: nextHref,
      primary: true,
    };
  }

  if (snapshot.primaryMission) {
    return {
      id: "intent:today-priority:plan",
      resultType: "answer",
      eyebrow: "Best next move",
      label: snapshot.primaryMission.title,
      detail: snapshot.primaryMission.summary,
      href: href(snapshot.primaryMission.href),
      primary: true,
    };
  }

  return {
    id: "intent:today-priority:recommendation",
    resultType: "answer",
    eyebrow: "Best next move",
    label: snapshot.strategy.recommendedMission.title,
    detail: snapshot.strategy.recommendedMission.rationale,
    href: href(snapshot.strategy.recommendedMission.href),
    primary: true,
  };
}

async function genericObjectResults(input: {
  db: SupabaseClient<Database>;
  ownerId: string;
  artistId: string;
  query: string;
}) {
  const [tracks, releases, mixes] = await Promise.all([
    searchTracks(input.db, input.ownerId, input.artistId, input.query),
    searchReleases(input.db, input.ownerId, input.artistId, input.query),
    searchMixes(input.db, input.ownerId, input.artistId, input.query),
  ]);
  const href = (path: string) => ensemblisArtistHref(path, input.artistId);
  return [
    ...tracks.map((track) => ({
      id: `track:${track.id}`,
      resultType: "object" as const,
      eyebrow: "Track",
      label: track.title,
      detail: track.status.replaceAll("_", " "),
      href: href(`/studio/music/${track.id}`),
    })),
    ...releases.map((release) => ({
      id: `release:${release.id}`,
      resultType: "object" as const,
      eyebrow: "Release",
      label: release.title,
      detail: `${release.release_type} · ${release.status}`,
      href: href(`/studio/releases/${release.id}`),
    })),
    ...mixes.map((mix) => ({
      id: `mix:${mixRoot(mix)}`,
      resultType: "object" as const,
      eyebrow: "Mix",
      label: mix.name,
      detail: `${mix.track_ids.length} tracks · ${mix.status === "completed" ? "ready" : mix.status}`,
      href: href(`/studio/music/automix?mix=${encodeURIComponent(mixRoot(mix))}&source=${mixSource(mix)}`),
    })),
  ].slice(0, 10);
}

export async function resolveStudioIntent(input: {
  db: SupabaseClient<Database>;
  ownerId: string;
  artist: ArtistContext;
  query: string;
  allowSemanticFallback?: boolean;
}): Promise<StudioIntentResolution> {
  let intent = classifyStudioIntent(input.query);
  let usedSemanticFallback = false;
  const direct = directResult(intent.kind, input.artist.artistId);
  const refersToExistingRelease = intent.kind === "prepare_release"
    && /\b(?:my|the)\s+(?:(?:latest|newest|current|active)\s+)?(?:release|single|album|ep)\b/i.test(input.query);
  const hasSpecificMixSource = intent.kind === "mix_music" && intent.objectType === "track";
  if (direct.length && !intent.objectQuery && !refersToExistingRelease && !hasSpecificMixSource) {
    return { intent, results: direct, usedSemanticFallback };
  }

  const resolveSpecific = async (candidateIntent: ClassifiedStudioIntent) => {
    if (candidateIntent.kind === "today_priority") {
      return [await todayPriorityAnswer({
        db: input.db,
        ownerId: input.ownerId,
        artist: input.artist,
      })];
    }
    if (candidateIntent.objectType === "track") {
      const tracks = await searchTracks(input.db, input.ownerId, input.artist.artistId, candidateIntent.objectQuery);
      const chosen = chooseByLabel(tracks, candidateIntent.objectQuery);
      const results = chosen
        ? [actionForTrack(candidateIntent, chosen, input.artist.artistId)]
        : tracks.map((track) => actionForTrack(candidateIntent, track, input.artist.artistId));
      return results;
    }
    if (candidateIntent.objectType === "release") {
      const releases = await searchReleases(input.db, input.ownerId, input.artist.artistId, candidateIntent.objectQuery);
      const chosen = chooseByLabel(releases, candidateIntent.objectQuery);
      if (chosen && (candidateIntent.kind === "release_readiness" || candidateIntent.kind === "release_results")) {
        return [await releaseAnswer({ db: input.db, ownerId: input.ownerId, artist: input.artist, release: chosen, intent: candidateIntent })];
      }
      return chosen
        ? [actionForRelease(candidateIntent, chosen, input.artist.artistId)]
        : releases.map((release) => actionForRelease(candidateIntent, release, input.artist.artistId));
    }
    if (candidateIntent.objectType === "mix") {
      const mixes = await searchMixes(input.db, input.ownerId, input.artist.artistId, candidateIntent.objectQuery);
      const href = (path: string) => ensemblisArtistHref(path, input.artist.artistId);
      return mixes.map((mix, index) => ({
        id: `mix:${mixRoot(mix)}`,
        resultType: "action" as const,
        eyebrow: index === 0 ? "Continue" : "Mix",
        label: mix.name,
        detail: `${mix.track_ids.length} tracks · ${mix.status === "completed" ? "ready" : mix.status}`,
        href: href(`/studio/music/automix?mix=${encodeURIComponent(mixRoot(mix))}&source=${mixSource(mix)}`),
        primary: index === 0,
      }));
    }
    if (candidateIntent.kind === "create_from_object") {
      const [tracks, releases] = await Promise.all([
        searchTracks(input.db, input.ownerId, input.artist.artistId, candidateIntent.objectQuery),
        searchReleases(input.db, input.ownerId, input.artist.artistId, candidateIntent.objectQuery),
      ]);
      const exactTrack = chooseByLabel(tracks, candidateIntent.objectQuery);
      const exactRelease = chooseByLabel(releases, candidateIntent.objectQuery);
      if (exactTrack && !exactRelease) return [actionForTrack(candidateIntent, exactTrack, input.artist.artistId)];
      if (exactRelease && !exactTrack) return [actionForRelease(candidateIntent, exactRelease, input.artist.artistId)];
      return [
        ...tracks.map((track) => actionForTrack(candidateIntent, track, input.artist.artistId)),
        ...releases.map((release) => actionForRelease(candidateIntent, release, input.artist.artistId)),
      ].slice(0, 8);
    }
    return genericObjectResults({
      db: input.db,
      ownerId: input.ownerId,
      artistId: input.artist.artistId,
      query: candidateIntent.objectQuery || input.query,
    });
  };

  let results = await resolveSpecific(intent);

  if (
    input.allowSemanticFallback
    && intent.confidence === "low"
    && input.query.trim().split(/\s+/).length >= 3
    && (!results.length || intent.kind === "open_object")
  ) {
    const semantic = await semanticIntent({
      ownerId: input.ownerId,
      artistId: input.artist.artistId,
      query: input.query,
    });
    if (semantic && semantic.kind !== "unknown") {
      const semanticResults = await resolveSpecific(semantic);
      if (semanticResults.length || directResult(semantic.kind, input.artist.artistId).length) {
        intent = semantic;
        usedSemanticFallback = true;
        results = semanticResults.length ? semanticResults : directResult(semantic.kind, input.artist.artistId);
      }
    }
  }

  if (!results.length && intent.objectQuery) {
    results = await genericObjectResults({
      db: input.db,
      ownerId: input.ownerId,
      artistId: input.artist.artistId,
      query: intent.objectQuery,
    });
  }

  return { intent, results, usedSemanticFallback };
}
