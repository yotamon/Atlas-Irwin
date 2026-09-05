import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { asFanGraphClient } from "@/lib/audience/fan-graph-db";
import type { Database } from "@/types/database";
import type {
  FanChannel,
  FanIdentity,
  FanPermission,
  FanProfile,
  FanRelationshipState,
} from "@/types/fan-graph-database";

export type FanRelationshipAction = {
  title: string;
  detail: string;
  href: string;
  interactionId: string | null;
};

export type FanRelationshipCard = {
  id: string;
  displayName: string;
  relationshipState: FanRelationshipState;
  firstSeenAt: string;
  lastSeenAt: string;
  interactionCount: number;
  identities: Array<{
    id: string;
    channel: FanChannel;
    label: string;
    evidence: FanIdentity["evidence_level"];
  }>;
  permissions: Array<{
    identityId: string;
    channel: FanChannel;
    purpose: FanPermission["purpose"];
    status: FanPermission["status"];
  }>;
  grantedPermissionCount: number;
  nextAction: FanRelationshipAction | null;
};

export type FanGraphSummary = {
  profiles: FanRelationshipCard[];
  returningCount: number;
  knownSupporterCount: number;
  needsReplyCount: number;
  permissionedIdentityCount: number;
};

function identityLabel(identity: FanIdentity) {
  if (identity.handle) return identity.handle.startsWith("@") ? identity.handle : `@${identity.handle}`;
  if (identity.identifier_kind === "verified_email") return "Verified email";
  if (identity.identifier_kind === "verified_phone") return "Verified phone";
  return identity.display_name || identity.channel.replaceAll("_", " ");
}

function profileDisplayName(profile: FanProfile, identities: FanIdentity[]) {
  return profile.display_name
    || identities.find((identity) => identity.display_name)?.display_name
    || identities.find((identity) => identity.handle)?.handle
    || "Listener";
}

export async function loadFanGraphSummary(
  client: SupabaseClient<Database>,
  ownerId: string,
  artistId: string,
): Promise<FanGraphSummary> {
  const db = asFanGraphClient(client);
  const [profilesResult, identitiesResult, permissionsResult, linksResult, pendingInteractionsResult] = await Promise.all([
    db.from("fan_profiles").select("*").eq("owner_id", ownerId).eq("artist_id", artistId).is("merged_into_fan_id", null).order("last_seen_at", { ascending: false }).limit(250),
    db.from("fan_identities").select("*").eq("owner_id", ownerId).eq("artist_id", artistId).order("last_seen_at", { ascending: false }).limit(1000),
    db.from("fan_permissions").select("*").eq("owner_id", ownerId).eq("artist_id", artistId).limit(2000),
    db.from("fan_interaction_links").select("interaction_id,identity_id").eq("owner_id", ownerId).eq("artist_id", artistId).order("linked_at", { ascending: false }).limit(2000),
    db.from("audience_interactions").select("id,status,suggested_reply,platform,occurred_at").eq("owner_id", ownerId).eq("artist_id", artistId).not("status", "in", "(ignored,replied)").order("occurred_at", { ascending: false }).limit(500),
  ]);
  for (const result of [profilesResult, identitiesResult, permissionsResult, linksResult, pendingInteractionsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const profiles = profilesResult.data ?? [];
  const identities = identitiesResult.data ?? [];
  const permissions = permissionsResult.data ?? [];
  const links = linksResult.data ?? [];
  const pendingInteractions = pendingInteractionsResult.data ?? [];
  const identityById = new Map(identities.map((identity) => [identity.id, identity]));
  const interactionById = new Map(pendingInteractions.map((interaction) => [interaction.id, interaction]));
  const pendingByFan = new Map<string, typeof pendingInteractions[number]>();

  for (const link of links) {
    const identity = identityById.get(link.identity_id);
    const interaction = interactionById.get(link.interaction_id);
    if (!identity || !interaction) continue;
    const current = pendingByFan.get(identity.fan_id);
    if (!current || new Date(interaction.occurred_at).getTime() > new Date(current.occurred_at).getTime()) {
      pendingByFan.set(identity.fan_id, interaction);
    }
  }

  const cards: FanRelationshipCard[] = profiles.map((profile) => {
    const fanIdentities = identities.filter((identity) => identity.fan_id === profile.id);
    const fanIdentityIds = new Set(fanIdentities.map((identity) => identity.id));
    const fanPermissions = permissions.filter((permission) => fanIdentityIds.has(permission.identity_id));
    const pending = pendingByFan.get(profile.id) ?? null;
    const nextAction: FanRelationshipAction | null = pending ? {
      title: pending.suggested_reply ? "Review the prepared reply" : "Review this conversation",
      detail: `${pending.platform.replaceAll("_", " ")} has a ${pending.status.replaceAll("_", " ")} interaction waiting for judgment.`,
      href: `/studio/audience#interaction-${pending.id}`,
      interactionId: pending.id,
    } : null;
    return {
      id: profile.id,
      displayName: profileDisplayName(profile, fanIdentities),
      relationshipState: profile.relationship_state,
      firstSeenAt: profile.first_seen_at,
      lastSeenAt: profile.last_seen_at,
      interactionCount: profile.interaction_count,
      identities: fanIdentities.map((identity) => ({
        id: identity.id,
        channel: identity.channel,
        label: identityLabel(identity),
        evidence: identity.evidence_level,
      })),
      permissions: fanPermissions.map((permission) => ({
        identityId: permission.identity_id,
        channel: permission.channel,
        purpose: permission.purpose,
        status: permission.status,
      })),
      grantedPermissionCount: fanPermissions.filter((permission) => permission.status === "granted").length,
      nextAction,
    };
  });

  return {
    profiles: cards,
    returningCount: cards.filter((profile) => profile.relationshipState === "returning").length,
    knownSupporterCount: cards.filter((profile) => profile.relationshipState === "known_supporter").length,
    needsReplyCount: cards.filter((profile) => profile.nextAction).length,
    permissionedIdentityCount: new Set(
      permissions.filter((permission) => permission.status === "granted").map((permission) => permission.identity_id),
    ).size,
  };
}

export async function loadFanDetail(
  client: SupabaseClient<Database>,
  ownerId: string,
  artistId: string,
  fanId: string,
) {
  const db = asFanGraphClient(client);
  const [profileResult, identitiesResult, permissionsResult, mergeEventsResult] = await Promise.all([
    db.from("fan_profiles").select("*").eq("id", fanId).eq("owner_id", ownerId).eq("artist_id", artistId).is("merged_into_fan_id", null).maybeSingle(),
    db.from("fan_identities").select("*").eq("fan_id", fanId).eq("owner_id", ownerId).eq("artist_id", artistId).order("last_seen_at", { ascending: false }),
    db.from("fan_permissions").select("*").eq("owner_id", ownerId).eq("artist_id", artistId).order("updated_at", { ascending: false }),
    db.from("fan_merge_events").select("*").eq("owner_id", ownerId).eq("artist_id", artistId).or(`source_fan_id.eq.${fanId},target_fan_id.eq.${fanId}`).order("created_at", { ascending: false }).limit(20),
  ]);
  for (const result of [profileResult, identitiesResult, permissionsResult, mergeEventsResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (!profileResult.data) return null;

  const identities = identitiesResult.data ?? [];
  const identityIds = identities.map((identity) => identity.id);
  const permissions = (permissionsResult.data ?? []).filter((permission) => identityIds.includes(permission.identity_id));
  let interactions: Array<{
    id: string;
    platform: string;
    interaction_type: string;
    body: string;
    occurred_at: string;
    status: string;
    sentiment: string | null;
    suggested_reply: string | null;
  }> = [];

  if (identityIds.length) {
    const linksResult = await db.from("fan_interaction_links").select("interaction_id,identity_id").eq("owner_id", ownerId).eq("artist_id", artistId).in("identity_id", identityIds).order("linked_at", { ascending: false }).limit(250);
    if (linksResult.error) throw new Error(linksResult.error.message);
    const interactionIds = [...new Set((linksResult.data ?? []).map((link) => link.interaction_id))];
    if (interactionIds.length) {
      const interactionsResult = await db.from("audience_interactions")
        .select("id,platform,interaction_type,body,occurred_at,status,sentiment,suggested_reply")
        .eq("owner_id", ownerId)
        .eq("artist_id", artistId)
        .in("id", interactionIds)
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (interactionsResult.error) throw new Error(interactionsResult.error.message);
      interactions = interactionsResult.data ?? [];
    }
  }

  return {
    profile: profileResult.data,
    identities,
    permissions,
    interactions,
    mergeEvents: mergeEventsResult.data ?? [],
  };
}

export function fanExportPayload(detail: NonNullable<Awaited<ReturnType<typeof loadFanDetail>>>) {
  return {
    exportedAt: new Date().toISOString(),
    relationship: {
      id: detail.profile.id,
      displayName: detail.profile.display_name,
      relationshipState: detail.profile.relationship_state,
      firstSeenAt: detail.profile.first_seen_at,
      lastSeenAt: detail.profile.last_seen_at,
      interactionCount: detail.profile.interaction_count,
    },
    identities: detail.identities.map((identity) => ({
      channel: identity.channel,
      identifierKind: identity.identifier_kind,
      handle: identity.handle,
      displayName: identity.display_name,
      evidenceLevel: identity.evidence_level,
      verifiedAt: identity.verified_at,
      firstSeenAt: identity.first_seen_at,
      lastSeenAt: identity.last_seen_at,
    })),
    permissions: detail.permissions.map((permission) => ({
      channel: permission.channel,
      purpose: permission.purpose,
      status: permission.status,
      source: permission.source,
      evidenceAt: permission.evidence_at,
      expiresAt: permission.expires_at,
    })),
    interactions: detail.interactions.map((interaction) => ({
      platform: interaction.platform,
      type: interaction.interaction_type,
      body: interaction.body,
      occurredAt: interaction.occurred_at,
      status: interaction.status,
    })),
  };
}
