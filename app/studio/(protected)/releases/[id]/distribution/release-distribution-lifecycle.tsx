import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { requestDistributionTakedown, syncDistributionStatus } from "@/app/studio/distribution-actions-safe";
import type { DistributionDatabase } from "@/types/distribution-database";

type Db = SupabaseClient<DistributionDatabase>;

export default async function ReleaseDistributionLifecycle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as Db;
  const [configResult, deliveriesResult, operationsResult] = await Promise.all([
    db.from("release_distribution_configs").select("state,provider_release_id").eq("release_id", id).eq("owner_id", user.id).maybeSingle(),
    db.from("distribution_deliveries").select("id,store_id,store_name,state,provider_status,store_url").eq("release_id", id).eq("owner_id", user.id).order("store_name"),
    db.from("distribution_provider_operations").select("id,state,operation_type").eq("release_id", id).eq("owner_id", user.id).eq("operation_type", "takedown").in("state", ["started", "ambiguous"]).limit(1),
  ]);
  for (const result of [configResult, deliveriesResult, operationsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const config = configResult.data;
  const deliveries = deliveriesResult.data ?? [];
  const eligible = deliveries.filter((delivery) => ["delivered", "live", "error", "rejected"].includes(delivery.state));
  const unresolvedTakedown = Boolean(operationsResult.data?.length);
  const lifecycleVisible = Boolean(config?.provider_release_id && (["delivered", "partially_live", "live", "error", "rejected", "takedown_pending"].includes(config.state) || eligible.length));
  if (!lifecycleVisible) return null;

  return <div className="distribution-page distribution-release-workspace">
    <section className="distribution-section distribution-lifecycle-card">
      <div className="distribution-section-heading">
        <div>
          <span className="section-label">Release lifecycle</span>
          <h2>Store removal & reconciliation</h2>
          <p>Takedowns are destructive and store-specific. Ensemblis validates the request first, records durable intent, then sends one provider request and never retries an ambiguous result automatically.</p>
        </div>
        <form action={syncDistributionStatus}>
          <input type="hidden" name="release_id" value={id} />
          <button className="button" type="submit">Refresh store status</button>
        </form>
      </div>

      {unresolvedTakedown ? <div className="distribution-feedback error" role="alert"><strong>Reconciliation required</strong><span>A previous takedown has an uncertain provider result. Refresh status or resolve it in Distribution Operations before another removal request.</span></div> : null}

      {eligible.length ? <form action={requestDistributionTakedown} className="distribution-form distribution-takedown-form">
        <input type="hidden" name="release_id" value={id} />
        <div className="distribution-form-block">
          <h3>Choose services to remove</h3>
          <p>Only services with a delivered, live, rejected or provider-error state are eligible. Services already in takedown are intentionally excluded.</p>
          <div className="distribution-checkboxes">
            {eligible.map((delivery) => <label key={delivery.id}>
              <input type="checkbox" name="store_id" value={delivery.store_id} disabled={unresolvedTakedown} />
              <span><strong>{delivery.store_name}</strong><small>{delivery.state.replaceAll("_", " ")}{delivery.provider_status ? ` · provider ${delivery.provider_status}` : ""}</small></span>
            </label>)}
          </div>
        </div>
        <label className="distribution-final-confirm">
          <input type="checkbox" name="confirm_takedown" disabled={unresolvedTakedown} />
          I understand this requests removal from the selected music services and explicitly approve the takedown.
        </label>
        <div className="actions">
          <button className="button" type="submit" disabled={unresolvedTakedown}>Request takedown</button>
          <span className="distribution-muted">The provider dry-run must pass before any destructive request is sent.</span>
        </div>
      </form> : <div className="distribution-form-block"><h3>No stores currently eligible for a new takedown</h3><p className="distribution-muted">If a removal is already in progress, refresh provider status until each selected service confirms removal.</p></div>}
    </section>
  </div>;
}
