import type {
  FanIdentity,
  FanPermission,
  FanProfile,
} from "@/types/fan-graph-database";

export const FAN_QUALITY_BANDS = ["new", "engaged", "qualified", "core", "inactive"] as const;
export type FanQualityBand = (typeof FAN_QUALITY_BANDS)[number];

type QualityProfile = Pick<FanProfile, "id" | "relationship_state" | "interaction_count">;
type QualityIdentity = Pick<
  FanIdentity,
  "id" | "fan_id" | "channel" | "identifier_kind" | "evidence_level" | "verified_at"
>;
type QualityPermission = Pick<
  FanPermission,
  "identity_id" | "channel" | "purpose" | "status" | "evidence_at" | "expires_at"
>;

export type FanQualityAssessment = {
  fanId: string;
  band: FanQualityBand;
  repeatEngaged: boolean;
  ownedReachable: boolean;
  verifiedIdentity: boolean;
  reasons: string[];
};

export type FanQualitySnapshot = {
  activeRelationshipCount: number;
  engagedFanCount: number;
  qualifiedFanCount: number;
  coreFanCount: number;
  repeatEngagedCount: number;
  ownedReachableCount: number;
  repeatRelationshipRate: number;
};

function permissionIsCurrent(permission: QualityPermission, now: Date) {
  return permission.status === "granted"
    && Boolean(permission.evidence_at)
    && (!permission.expires_at || Date.parse(permission.expires_at) > now.getTime());
}

export function isCurrentOwnedMarketingPermission(
  identity: QualityIdentity,
  permission: QualityPermission,
  now = new Date(),
) {
  if (permission.identity_id !== identity.id || !identity.verified_at || !permissionIsCurrent(permission, now)) {
    return false;
  }

  const validEmail = identity.channel === "email"
    && identity.identifier_kind === "verified_email"
    && permission.channel === "email"
    && permission.purpose === "email_marketing";
  const validSms = identity.channel === "sms"
    && identity.identifier_kind === "verified_phone"
    && permission.channel === "sms"
    && permission.purpose === "sms_marketing";

  return validEmail || validSms;
}

export function permissionedOwnedFanIds(
  identities: QualityIdentity[],
  permissions: QualityPermission[],
  now = new Date(),
) {
  const permissioned = new Set<string>();
  const identityById = new Map(identities.map((identity) => [identity.id, identity]));

  for (const permission of permissions) {
    const identity = identityById.get(permission.identity_id);
    if (identity && isCurrentOwnedMarketingPermission(identity, permission, now)) {
      permissioned.add(identity.fan_id);
    }
  }

  return permissioned;
}

export function assessFanQuality({
  profile,
  identities,
  permissions,
  now = new Date(),
}: {
  profile: QualityProfile;
  identities: QualityIdentity[];
  permissions: QualityPermission[];
  now?: Date;
}): FanQualityAssessment {
  if (profile.relationship_state === "inactive") {
    return {
      fanId: profile.id,
      band: "inactive",
      repeatEngaged: false,
      ownedReachable: false,
      verifiedIdentity: false,
      reasons: ["No current relationship activity"],
    };
  }

  const fanIdentities = identities.filter((identity) => identity.fan_id === profile.id);
  const fanIdentityIds = new Set(fanIdentities.map((identity) => identity.id));
  const fanPermissions = permissions.filter((permission) => fanIdentityIds.has(permission.identity_id));
  const ownedReachable = permissionedOwnedFanIds(fanIdentities, fanPermissions, now).has(profile.id);
  const verifiedIdentity = fanIdentities.some((identity) =>
    Boolean(identity.verified_at) && (identity.evidence_level === "verified" || identity.evidence_level === "explicit"),
  );
  const repeatEngaged = profile.relationship_state === "returning"
    || profile.relationship_state === "known_supporter"
    || profile.interaction_count >= 2;
  const strongRelationshipEvidence = profile.relationship_state === "known_supporter"
    || profile.interaction_count >= 3
    || ownedReachable
    || verifiedIdentity;

  const reasons: string[] = [];
  if (repeatEngaged) reasons.push("Repeated engagement observed");
  if (profile.relationship_state === "known_supporter") reasons.push("Known supporter relationship");
  if (profile.interaction_count >= 3) reasons.push("Multiple meaningful interactions");
  if (verifiedIdentity) reasons.push("Verified identity evidence");
  if (ownedReachable) reasons.push("Directly reachable with current explicit marketing permission");

  let band: FanQualityBand = "new";
  if (ownedReachable && repeatEngaged && strongRelationshipEvidence) band = "core";
  else if (repeatEngaged && strongRelationshipEvidence) band = "qualified";
  else if (repeatEngaged || profile.interaction_count > 0) band = "engaged";

  if (!reasons.length) reasons.push("Relationship observed; more evidence is needed before treating it as fandom");

  return {
    fanId: profile.id,
    band,
    repeatEngaged,
    ownedReachable,
    verifiedIdentity,
    reasons,
  };
}

export function summarizeFanQuality(
  profiles: QualityProfile[],
  identities: QualityIdentity[],
  permissions: QualityPermission[],
  now = new Date(),
): FanQualitySnapshot {
  const assessments = profiles.map((profile) => assessFanQuality({ profile, identities, permissions, now }));
  const active = assessments.filter((assessment) => assessment.band !== "inactive");
  const engaged = active.filter((assessment) => ["engaged", "qualified", "core"].includes(assessment.band));
  const qualified = active.filter((assessment) => assessment.band === "qualified" || assessment.band === "core");
  const core = active.filter((assessment) => assessment.band === "core");
  const repeat = active.filter((assessment) => assessment.repeatEngaged);
  const owned = active.filter((assessment) => assessment.ownedReachable);

  return {
    activeRelationshipCount: active.length,
    engagedFanCount: engaged.length,
    qualifiedFanCount: qualified.length,
    coreFanCount: core.length,
    repeatEngagedCount: repeat.length,
    ownedReachableCount: owned.length,
    repeatRelationshipRate: active.length ? repeat.length / active.length : 0,
  };
}

export function fanQualityPlanningContext(snapshot: FanQualitySnapshot) {
  return `First-party fan evidence: ${snapshot.activeRelationshipCount} active relationship${snapshot.activeRelationshipCount === 1 ? "" : "s"}; ${snapshot.engagedFanCount} engaged; ${snapshot.qualifiedFanCount} qualified; ${snapshot.coreFanCount} core; ${snapshot.ownedReachableCount} directly reachable with verified, current marketing permission. Treat reach as discovery rather than fandom, and prefer creative that deepens repeat engagement, listening intent or permissioned relationships.`;
}
