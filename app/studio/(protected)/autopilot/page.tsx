import Link from "next/link";
import { dismissMarketingOpportunity, dismissNextBestAction, refreshAutopilot } from "@/app/studio/autonomy-actions";
import { PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { createAutonomyServiceClient } from "@/lib/marketing/autonomy-db";

function actionHref(action: { action_type: string; source_id: string | null }) {
  if (action.action_type === "reply_to_listener") return "/studio/audience";
  if (["approve_publication", "publish_overdue"].includes(action.action_type)) return "/studio/inbox";
  if (action.action_type === "repair_publication") return "/studio/production";
  return "/studio/growth";
}

export default async function AutopilotPage() {
  const { user } = await requireStudioAdmin();
  const db = createAutonomyServiceClient();
  const [actionsResult, opportunitiesResult, audienceResult] = await Promise.all([
    db.from("next_best_actions").select("*").eq("owner_id", user.id).eq("status", "proposed").order("score", { ascending: false }).limit(20),
    db.from("marketing_opportunities").select("*").eq("owner_id", user.id).eq("status", "new").order("score", { ascending: false }).order("urgency", { ascending: false }).limit(20),
    db.from("audience_interactions").select("id,status").eq("owner_id", user.id).in("status", ["needs_reply", "drafted"]),
  ]);
  const error = actionsResult.error || opportunitiesResult.error || audienceResult.error;
  if (error) throw new Error(error.message);
  const actions = actionsResult.data ?? [];
  const opportunities = opportunitiesResult.data ?? [];
  const audienceCount = audienceResult.data?.length ?? 0;

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Autopilot"
        description="Atlas watches what is happening, ranks the highest-leverage next move and keeps safe internal work automatic. External effects still require your approval."
        action={<div className="actions"><form action={refreshAutopilot}><button className="button" type="submit">Refresh signals</button></form><Link className="button" href="/studio/audience">Audience {audienceCount ? `(${audienceCount})` : ""}</Link></div>}
      />

      <section className="v2-section">
        <div className="v2-section-heading">
          <div><span className="section-label">Next best action</span><h2>{actions[0]?.title || "No higher-leverage intervention right now"}</h2></div>
          {actions[0] ? <span className="v2-count has-items">{Math.round(Number(actions[0].score))}/100</span> : null}
        </div>
        {actions[0] ? <p className="v2-muted-copy">{actions[0].rationale}</p> : <div className="v2-calm-state compact"><strong>Atlas can keep running the current plan.</strong><p>No evidence-backed action is strong enough to interrupt you.</p></div>}
        {actions[0] ? <div className="actions"><Link className="button primary" href={actionHref(actions[0])}>Act on this</Link><form action={dismissNextBestAction}><input type="hidden" name="id" value={actions[0].id} /><button className="button" type="submit">Dismiss</button></form></div> : null}
      </section>

      {actions.length > 1 ? (
        <section className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">Ranked queue</span><h2>What comes after that</h2></div><span className="v2-count">{actions.length - 1}</span></div>
          <div className="v2-inbox">
            {actions.slice(1).map((action) => (
              <article className="v2-inbox-item" key={action.id}>
                <div><Status>{Math.round(Number(action.score))}/100</Status><strong>{action.title}</strong><small>{action.rationale}</small><div className="actions"><Link className="button" href={actionHref(action)}>Open</Link><form action={dismissNextBestAction}><input type="hidden" name="id" value={action.id} /><button className="button" type="submit">Dismiss</button></form></div></div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Radar</span><h2>Evidence worth looking at</h2></div><span className={`v2-count${opportunities.length ? " has-items" : ""}`}>{opportunities.length}</span></div>
        <p className="v2-muted-copy">External trends are references, not instructions. Atlas scores recency and momentum, then asks whether the format belongs in the Atlas Irwin world.</p>
        {opportunities.length ? <div className="v2-inbox">{opportunities.map((opportunity) => (
          <article className="v2-inbox-item" key={opportunity.id}>
            <div><div className="actions"><Status>{opportunity.kind}</Status><Status>{Math.round(Number(opportunity.score))}/100</Status></div><strong>{opportunity.title}</strong><small>{opportunity.summary}</small>{opportunity.recommended_action ? <p>{opportunity.recommended_action}</p> : null}<div className="actions">{opportunity.url ? <a className="button" href={opportunity.url} target="_blank" rel="noreferrer">Inspect source</a> : null}<form action={dismissMarketingOpportunity}><input type="hidden" name="id" value={opportunity.id} /><button className="button" type="submit">Not relevant</button></form></div></div>
          </article>
        ))}</div> : <div className="v2-calm-state compact"><strong>No strong opportunity signal yet.</strong><p>Atlas will prefer silence over inventing a trend.</p></div>}
      </section>
    </div>
  );
}
