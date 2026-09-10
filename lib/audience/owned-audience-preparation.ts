import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { asFanGraphClient } from "@/lib/audience/fan-graph-db";
import { permissionedOwnedFanIds } from "@/lib/audience/fan-quality";
import { asSmartLinksClient } from "@/lib/smart-links/db";
import { asGrowthClient } from "@/lib/studio/growth-db";
import type { Database, Json } from "@/types/database";

const DEDUPE_KEY = "owned-audience:relationship-gap";
const PRESERVED_STATUSES = new Set(["accepted", "dismissed", "completed"]);

function json(value: unknown) {
  return value as Json;
}

export async function prepareOwnedAudienceOpportunity({
  client,
  ownerId,
  artistId,
  now = new Date(),
}: {
  client: SupabaseClient<Database>;
  ownerId: string;
  artistId: string;
  now?: Date;
}) {
  const fans = asFanGraphClient(client);
  const smart = asSmartLinksClient(client);
  const growth = asGrowthClient(client);

  const [profilesResult, identitiesResult, permissionsResult, smartLinksResult, readbackResult, existingResult] = await Promise.all([
    fans.from("fan_profiles")
      .select("id,relationship_state,interaction_count")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .is("merged_into_fan_id", null)
      .neq("relationship_state", "inactive")
      .limit(1000),
    fans.from("fan_identities")
      .select("id,fan_id,channel,identifier_kind,evidence_level,verified_at")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .limit(3000),
    fans.from("fan_permissions")
      .select("identity_id,channel,purpose,status,evidence_at,expires_at")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .eq("status", "granted")
      .limit(5000),
    smart.from("smart_links")
      .select("id,is_active")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .eq("is_active", true)
      .limit(250),
    smart.from("smart_link_readback")
      .select("smart_link_id,landing_views,outbound_clicks,verified_pre_save_completions")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .limit(250),
    growth.from("growth_opportunities")
      .select("id,status,dedupe_key")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .eq("dedupe_key", DEDUPE_KEY)
      .maybeSingle(),
  ]);

  for (const result of [profilesResult, identitiesResult, permissionsResult, smartLinksResult, readbackResult, existingResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const profiles = profilesResult.data ?? [];
  const identities = identitiesResult.data ?? [];
  const permissions = permissionsResult.data ?? [];
  const readback = readbackResult.data ?? [];
  const existing = existingResult.data ?? null;
  const permissionedFanIds = permissionedOwnedFanIds(identities, permissions, now);

  const engagedFanIds = new Set(
    profiles
      .filter((profile) => profile.relationship_state === "returning"
        || profile.relationship_state === "known_supporter"
        || Number(profile.interaction_count) >= 2)
      .map((profile) => profile.id),
  );
  const permissionedEngagedCount = [...engagedFanIds].filter((fanId) => permissionedFanIds.has(fanId)).length;
  const relationshipGap = Math.max(0, engagedFanIds.size - permissionedEngagedCount);
  const landingViews = readback.reduce((sum, item) => sum + Number(item.landing_views ?? 0), 0);
  const outboundClicks = readback.reduce((sum, item) => sum + Number(item.outbound_clicks ?? 0), 0);
  const verifiedPreSaves = readback.reduce((sum, item) => sum + Number(item.verified_pre_save_completions ?? 0), 0);
  const activeSmartLinks = smartLinksResult.data?.length ?? 0;
  const measurableAttention = landingViews >= 20 || outboundClicks >= 10 || verifiedPreSaves >= 3;

  if (relationshipGap <= 0 && permissionedFanIds.size <= 0 && !measurableAttention) {
    return {
      prepared: 0,
      reason: "no_owned_audience_signal" as const,
      engagedFans: engagedFanIds.size,
      permissionedFans: 0,
      relationshipGap: 0,
      landingViews,
    };
  }

  let title: string;
  let rationale: string;
  let priority: number;
  let recommendedAction: Record<string, unknown>;

  if (relationshipGap > 0) {
    title = `Turn ${relationshipGap} returning supporter${relationshipGap === 1 ? "" : "s"} into permissioned relationships`;
    rationale = `Fan Graph shows ${engagedFanIds.size} returning or known supporter${engagedFanIds.size === 1 ? "" : "s"}, but only ${permissionedEngagedCount} currently have a verified email or phone identity with explicit channel-specific marketing permission. Strengthen the consent-first capture path before adding more disconnected reach.`;
    priority = Math.min(96, 78 + relationshipGap * 3 + (measurableAttention ? 6 : 0));
    recommendedAction = {
      type: "strengthen_owned_audience_capture",
      href: "/studio/audience",
      consentRule: "Only verified email/SMS identities with current explicit permission may be treated as owned contacts.",
      externalContactRequiresApproval: true,
    };
  } else if (permissionedFanIds.size > 0) {
    title = `Build from ${permissionedFanIds.size} permissioned fan relationship${permissionedFanIds.size === 1 ? "" : "s"}`;
    rationale = `Ensemblis has ${permissionedFanIds.size} verified email or SMS relationship${permissionedFanIds.size === 1 ? "" : "s"} with current channel-specific marketing permission. Use this first-party baseline to plan repeat engagement without broadening consent or auto-sending messages.`;
    priority = 76;
    recommendedAction = {
      type: "develop_permissioned_audience_baseline",
      href: "/studio/audience",
      consentRule: "Never infer a new purpose, channel or identity from existing permission evidence.",
      externalContactRequiresApproval: true,
    };
  } else {
    title = "Turn first-party Smart Link attention into an owned-audience path";
    rationale = `Smart Links recorded ${landingViews} landing view${landingViews === 1 ? "" : "s"} and ${outboundClicks} outbound click${outboundClicks === 1 ? "" : "s"}, but there is no permissioned email or SMS relationship in the Fan Graph yet. Preserve this first-party attention by adding a consent-first capture path instead of relying only on platform reach.`;
    priority = 84;
    recommendedAction = {
      type: "add_consent_first_capture_path",
      href: "/studio/audience",
      consentRule: "Do not create an owned identity until contact verification and purpose-specific permission exist.",
      externalContactRequiresApproval: true,
    };
  }

  const row = {
    owner_id: ownerId,
    artist_id: artistId,
    kind: "owned_audience" as const,
    release_id: null,
    track_vault_id: null,
    content_item_id: null,
    title,
    rationale,
    priority,
    confidence: 0.98,
    evidence: json({
      source: "fan_graph_and_smart_links",
      engagedFanCount: engagedFanIds.size,
      permissionedFanCount: permissionedFanIds.size,
      permissionedEngagedCount,
      relationshipGap,
      activeSmartLinkCount: activeSmartLinks,
      landingViews,
      outboundClicks,
      verifiedPreSaves,
      consentDefinition: "verified email/SMS identity + current matching marketing permission + explicit evidence timestamp",
    }),
    recommended_action: json(recommendedAction),
    dedupe_key: DEDUPE_KEY,
    detected_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
  };

  if (existing) {
    const preserve = PRESERVED_STATUSES.has(existing.status);
    const status = preserve ? existing.status : existing.status === "expired" ? "new" as const : existing.status;
    const { error } = await growth.from("growth_opportunities")
      .update({ ...row, status })
      .eq("id", existing.id)
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId);
    if (error) throw new Error(error.message);
    return {
      prepared: existing.status === "expired" ? 1 : 0,
      reason: preserve ? "owned_audience_lifecycle_preserved" as const : existing.status === "expired" ? "owned_audience_reopened" as const : "owned_audience_already_prepared" as const,
      engagedFans: engagedFanIds.size,
      permissionedFans: permissionedFanIds.size,
      relationshipGap,
      landingViews,
    };
  }

  const { error } = await growth.from("growth_opportunities").insert({ ...row, status: "new" as const });
  if (error) throw new Error(error.message);
  return {
    prepared: 1,
    reason: "owned_audience_opportunity_prepared" as const,
    engagedFans: engagedFanIds.size,
    permissionedFans: permissionedFanIds.size,
    relationshipGap,
    landingViews,
  };
}
