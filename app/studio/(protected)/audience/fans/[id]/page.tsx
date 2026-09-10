import Link from "next/link";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { loadFanDetail } from "@/lib/audience/fan-graph-server";
import {
  addVerifiedFanIdentity,
  deleteFanPersonalData,
  mergeFanProfiles,
  revertFanMerge,
  revokeFanPermissions,
  saveFanPermission,
  saveFanProfile,
} from "@/app/studio/fan-actions";
import type { FanChannel, FanGraphDatabase, FanPermissionPurpose } from "@/types/fan-graph-database";

function shortDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function permissionPurposes(channel: FanChannel): FanPermissionPurpose[] {
  if (channel === "email") return ["email_marketing", "release_marketing", "proactive_updates"];
  if (channel === "sms") return ["sms_marketing", "release_marketing", "proactive_updates"];
  return ["release_marketing", "proactive_updates"];
}

export default async function FanRelationshipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const detail = await loadFanDetail(supabase, user.id, artist.artistId, id);
  if (!detail) notFound();

  const db = supabase as unknown as SupabaseClient<FanGraphDatabase>;
  const { data: mergeTargets, error: targetsError } = await db.from("fan_profiles")
    .select("id,display_name,relationship_state,interaction_count")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .is("merged_into_fan_id", null)
    .neq("id", id)
    .order("last_seen_at", { ascending: false })
    .limit(100);
  if (targetsError) throw new Error(targetsError.message);

  const hidden = <><input type="hidden" name="artist_id" value={artist.artistId} /><input type="hidden" name="fan_id" value={id} /></>;
  const displayName = detail.profile.display_name
    || detail.identities.find((identity) => identity.display_name)?.display_name
    || detail.identities.find((identity) => identity.handle)?.handle
    || "Listener";
  const activeMergeEvents = detail.mergeEvents.filter((event) => event.status === "active" && event.target_fan_id === id);

  return <div className="studio-v2-page audience-polish-page fan-detail-page">
    <PageHeader
      title={displayName}
      description={`Relationship memory for ${artist.artistName}. Identity and communication permission stay channel-specific unless explicit evidence says otherwise.`}
      action={<Link className="button" href="/studio/audience">Back to Audience</Link>}
    />

    <section className="fan-relationship-hero">
      <div><span className="section-label">Relationship</span><strong>{readable(detail.profile.relationship_state)}</strong><small>{detail.profile.interaction_count} interaction{detail.profile.interaction_count === 1 ? "" : "s"} · first seen {shortDate(detail.profile.first_seen_at)} · last seen {shortDate(detail.profile.last_seen_at)}</small></div>
      <form action={saveFanProfile} className="fan-profile-form">{hidden}<label>Display name<input name="display_name" defaultValue={detail.profile.display_name ?? ""} placeholder={displayName} /></label><label>Relationship state<select name="relationship_state" defaultValue={detail.profile.relationship_state}><option value="new">New</option><option value="returning">Returning</option><option value="known_supporter">Known supporter</option><option value="inactive">Inactive</option></select></label><button className="button" type="submit">Save relationship</button></form>
    </section>

    <section className="fan-detail-section">
      <div className="audience-polish-heading"><div><span className="section-label">Channel identities</span><h2>{detail.identities.length ? `${detail.identities.length} identity record${detail.identities.length === 1 ? "" : "s"}` : "No channel identities"}</h2></div></div>
      <p className="fan-privacy-note">A matching name or handle on another platform is not considered the same person. Cross-channel identity requires explicit or verified evidence.</p>
      <div className="fan-identity-grid">
        {detail.identities.map((identity) => {
          const permissions = detail.permissions.filter((permission) => permission.identity_id === identity.id);
          return <article className="fan-identity-card" key={identity.id}>
            <header><div><span>{readable(identity.channel)}</span><strong>{identity.handle || identity.display_name || readable(identity.identifier_kind)}</strong></div><small>{readable(identity.evidence_level)} evidence</small></header>
            <p>{readable(identity.identifier_kind)} · seen {shortDate(identity.first_seen_at)} to {shortDate(identity.last_seen_at)}</p>
            <div className="fan-permission-list">
              {permissions.length ? permissions.map((permission) => <div key={permission.id}><span>{readable(permission.purpose)}</span><strong data-status={permission.status}>{readable(permission.status)}</strong>{permission.evidence_note ? <small>{permission.evidence_note}</small> : null}</div>) : <small>No communication permission has been recorded for this identity.</small>}
            </div>
            <details className="fan-detail-control"><summary>Record channel permission</summary><form action={saveFanPermission}>{hidden}<input type="hidden" name="identity_id" value={identity.id} /><label>Purpose<select name="purpose" defaultValue={permissionPurposes(identity.channel)[0]}>{permissionPurposes(identity.channel).map((purpose) => <option value={purpose} key={purpose}>{readable(purpose)}</option>)}</select></label><label>Status<select name="status" defaultValue="unknown"><option value="unknown">Unknown</option><option value="granted">Granted</option><option value="revoked">Revoked</option></select></label><label>Evidence note<textarea name="evidence_note" rows={2} maxLength={1000} placeholder="Required for a manual grant: where and when did the person consent?" /></label><button className="button" type="submit">Save permission</button></form></details>
          </article>;
        })}
      </div>
      <details className="fan-detail-control"><summary>Add a verified contact identity</summary><form action={addVerifiedFanIdentity} className="fan-inline-form">{hidden}<label>Type<select name="identity_kind" defaultValue="email"><option value="email">Verified email</option><option value="phone">Verified phone</option></select></label><label>Verified contact<input name="identifier" required placeholder="name@example.com or +491234567890" /></label><label className="inline-check"><input type="checkbox" name="confirm_verified" required />I have verified that this contact identity belongs to this person.</label><button className="button" type="submit">Add verified identity</button></form></details>
    </section>

    <section className="fan-detail-section">
      <div className="audience-polish-heading"><div><span className="section-label">Conversation history</span><h2>{detail.interactions.length ? `${detail.interactions.length} recent interaction${detail.interactions.length === 1 ? "" : "s"}` : "No linked conversation history"}</h2></div></div>
      <div className="fan-history-list">{detail.interactions.map((interaction) => <article key={interaction.id}><header><span>{readable(interaction.platform)} · {readable(interaction.interaction_type)}</span><small>{shortDate(interaction.occurred_at)} · {readable(interaction.status)}</small></header><p>{interaction.body}</p></article>)}</div>
    </section>

    <section className="fan-detail-section">
      <div className="audience-polish-heading"><div><span className="section-label">Identity safety</span><h2>Merge only with evidence</h2></div></div>
      <p className="fan-privacy-note">Ensemblis never proposes a merge from behavioral similarity. Use this only when you have explicit confirmation, a verified contact match, or a provider-verified link.</p>
      {mergeTargets?.length ? <details className="fan-detail-control"><summary>Merge another relationship into this one</summary><form action={mergeFanProfiles} className="fan-inline-form">{hidden}<input type="hidden" name="target_fan_id" value={id} /><label>Relationship<select name="source_fan_id" required defaultValue=""><option value="" disabled>Choose a relationship</option>{mergeTargets.map((target) => <option key={target.id} value={target.id}>{target.display_name || "Listener"} · {target.interaction_count} interactions</option>)}</select></label><label>Evidence<select name="evidence_type" defaultValue="explicit_confirmation"><option value="explicit_confirmation">Explicit confirmation</option><option value="verified_contact_match">Verified contact match</option><option value="provider_verified_link">Provider-verified link</option></select></label><label>Evidence note<textarea name="evidence_note" rows={2} required minLength={3} maxLength={1000} /></label><button className="button" type="submit">Merge with evidence</button></form></details> : null}
      {activeMergeEvents.length ? <div className="fan-merge-history">{activeMergeEvents.map((event) => <div key={event.id}><span><strong>{readable(event.evidence_type)}</strong><small>{event.evidence_note} · {shortDate(event.merged_at)}</small></span><form action={revertFanMerge}>{hidden}<input type="hidden" name="merge_id" value={event.id} /><button className="text-button" type="submit">Undo merge</button></form></div>)}</div> : null}
    </section>

    <section className="fan-detail-section fan-privacy-section">
      <div className="audience-polish-heading"><div><span className="section-label">Privacy & consent</span><h2>Portable, revocable, deletable</h2></div></div>
      <p className="fan-privacy-note">Export contains the relationship data Ensemblis currently holds. Revocation affects recorded communication permissions. Delete redacts linked audience-message personal data and removes the relationship identities.</p>
      <div className="fan-privacy-actions"><Link className="button" href={`/api/studio/audience/fans/${id}/export?artist_id=${encodeURIComponent(artist.artistId)}`}>Export relationship data</Link><form action={revokeFanPermissions}>{hidden}<button className="button" type="submit">Revoke all recorded permissions</button></form></div>
      <details className="fan-danger-control"><summary>Delete this person&apos;s personal data</summary><form action={deleteFanPersonalData}>{hidden}<p>This removes identities and permission records and redacts linked audience messages. Type DELETE to confirm.</p><input name="confirm_delete" required pattern="DELETE" autoComplete="off" /><button className="button" type="submit">Delete personal data</button></form></details>
    </section>
  </div>;
}
