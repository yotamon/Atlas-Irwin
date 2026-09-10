import type { SupabaseClient } from "@supabase/supabase-js";
import {
  disableCampaignAiSpendEnvelope,
  saveCampaignAiSpendEnvelope,
} from "@/app/studio/campaign-ai-spend-actions";
import { requireStudioAdmin } from "@/lib/auth/studio";
import type { CreativeSpendDatabase } from "@/types/creative-spend-database";
import styles from "./marketing-workspace.module.css";

function money(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "$0.00";
}

function when(value: string | null) {
  if (!value) return "No expiry";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export async function CampaignAiSpendCard({
  campaignId,
  campaignMode,
}: {
  campaignId: string;
  campaignMode: string;
}) {
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as SupabaseClient<CreativeSpendDatabase>;
  const [envelopeResult, reservationsResult] = await Promise.all([
    db.from("campaign_ai_spend_envelopes")
      .select("*")
      .eq("owner_id", user.id)
      .eq("campaign_id", campaignId)
      .maybeSingle(),
    db.from("campaign_ai_spend_reservations")
      .select("*")
      .eq("owner_id", user.id)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  if (envelopeResult.error) throw new Error(envelopeResult.error.message);
  if (reservationsResult.error) throw new Error(reservationsResult.error.message);
  const envelope = envelopeResult.data;
  const reservations = reservationsResult.data ?? [];
  const spent = Number(envelope?.spent_usd ?? 0);
  const reserved = Number(envelope?.reserved_usd ?? 0);
  const limit = Number(envelope?.hard_limit_usd ?? 0);
  const overrun = Number(envelope?.overrun_usd ?? 0);
  const remaining = Math.max(0, limit - spent - reserved);
  const isAutopilot = campaignMode === "autopilot";
  const active = Boolean(envelope?.enabled && isAutopilot && overrun <= 0);

  return (
    <section className={styles.controlCard} aria-labelledby="campaign-ai-budget-title">
      <div className={styles.sectionHead}>
        <div>
          <span className={styles.eyebrow}>Trust envelope</span>
          <h2 id="campaign-ai-budget-title">AI Creative Budget</h2>
        </div>
        <span className={active ? styles.statusChip : styles.chip}>
          {overrun > 0 ? "Paused · provider overrun" : active ? "Autonomous spend enabled" : "Manual spend"}
        </span>
      </div>

      <p>
        Atlas may submit prepared image/video generations automatically only when this campaign is in Autopilot and this hard budget is enabled.
        Every provider call reserves its worst-case quote atomically first. Ambiguous submissions keep their reserve locked instead of retrying.
      </p>

      <div className={styles.statGrid}>
        <div className={styles.stat}><span>Hard cap</span><strong>{money(limit)}</strong><small>Maximum authorized creative media spend.</small></div>
        <div className={styles.stat}><span>Spent</span><strong>{money(spent)}</strong><small>Settled provider media cost.</small></div>
        <div className={styles.stat}><span>Reserved</span><strong>{money(reserved)}</strong><small>Accepted or ambiguous jobs not settled yet.</small></div>
        <div className={styles.stat}><span>Remaining</span><strong>{money(remaining)}</strong><small>{overrun > 0 ? `Overrun recorded: ${money(overrun)}.` : "Available before the campaign cap."}</small></div>
      </div>

      <form action={saveCampaignAiSpendEnvelope} className={styles.controlGroup}>
        <input type="hidden" name="campaign_id" value={campaignId} />
        <label>
          <span className={styles.miniLabel}>Total hard cap (USD)</span>
          <input name="hard_limit_usd" type="number" min="0" max="100000" step="0.01" defaultValue={limit || 20} required />
        </label>
        <label>
          <span className={styles.miniLabel}>Max one generation (USD)</span>
          <input name="max_single_generation_usd" type="number" min="0" max="100000" step="0.01" defaultValue={Number(envelope?.max_single_generation_usd ?? 3)} required />
        </label>
        <div>
          <span className={styles.miniLabel}>Allowed media</span>
          <label><input name="allow_image" type="checkbox" defaultChecked={!envelope || envelope.allowed_media_kinds.includes("image")} /> Images</label>{" "}
          <label><input name="allow_video" type="checkbox" defaultChecked={!envelope || envelope.allowed_media_kinds.includes("video")} /> Video</label>
        </div>
        <label>
          <input name="enabled" type="checkbox" defaultChecked={Boolean(envelope?.enabled)} disabled={!isAutopilot} />
          Enable autonomous paid creative generation
        </label>
        {!isAutopilot ? <small>Switch this campaign to Autopilot first. Campaign mode alone never authorizes spend.</small> : null}
        {envelope?.expires_at ? <small>Envelope expiry: {when(envelope.expires_at)}</small> : null}
        <button className="button primary" type="submit">Save AI creative budget</button>
      </form>

      {envelope?.enabled ? (
        <form action={disableCampaignAiSpendEnvelope}>
          <input type="hidden" name="campaign_id" value={campaignId} />
          <button className="button" type="submit">Pause autonomous creative spend</button>
        </form>
      ) : null}

      {reservations.length ? (
        <div className={styles.controlGroup}>
          <span className={styles.miniLabel}>Latest reservations</span>
          {reservations.map((reservation) => (
            <small key={reservation.id}>
              {reservation.media_kind} · {money(reservation.reserved_usd)} reserved · {reservation.status}
              {reservation.settled_usd !== null ? ` · ${money(reservation.settled_usd)} settled` : ""}
            </small>
          ))}
        </div>
      ) : null}
    </section>
  );
}
