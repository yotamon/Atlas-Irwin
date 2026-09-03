import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { updateModeFromProviderMetadata } from "@/lib/distribution/update-safety";
import { beginDistributionUpdate, requestDistributionTakedown, syncDistributionStatus } from "@/app/studio/distribution-actions-safe";
import type { DistributionDatabase } from "@/types/distribution-database";

type Db = SupabaseClient<DistributionDatabase>;

export default async function ReleaseDistributionLifecycle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as Db;
  const [configResult, deliveriesResult, operationsResult] = await Promise.all([
    db.from("release_distribution_configs").select("state,provider_release_id,provider_metadata").eq("release_id", id).eq("owner_id", user.id).maybeSingle(),
    db.from("distribution_deliveries").select("id,store_id,store_name,state,provider_status,store_url").eq("release_id", id).eq("owner_id", user.id).order("store_name"),
    db.from("distribution_provider_operations").select("id,state,operation_type").eq("release_id", id).eq("owner_id", user.id).in("state", ["started", "ambiguous"]),
  ]);
  for (const result of [configResult, deliveriesResult, operationsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const config = configResult.data;
  const deliveries = deliveriesResult.data ?? [];
  const updateMode = updateModeFromProviderMetadata(config?.provider_metadata);
  const unresolvedOperations = operationsResult.data ?? [];
  const unresolvedTakedown = unresolvedOperations.some((operation) => operation.operation_type === "takedown");
  const hasAnyUnresolvedOperation = unresolvedOperations.length > 0;
  const eligible = deliveries.filter((delivery) => ["delivered", "live", "error", "rejected"].includes(delivery.state));
  const stableForCorrection = Boolean(config && ["delivered", "partially_live", "live", "rejected"].includes(config.state));
  const lifecycleVisible = Boolean(config?.provider_release_id && (stableForCorrection || updateMode.active || ["error", "takedown_pending"].includes(config.state) || eligible.length));
  if (!lifecycleVisible) return null;

  return <div className="distribution-page distribution-release-workspace">
    <section className="distribution-section distribution-lifecycle-card">
      <div className="distribution-section-heading">
        <div>
          <span className="section-label">Release lifecycle</span>
          <h2>Corrections, removal & reconciliation</h2>
          <p>Once music is distributed, Ensemblis treats corrections and takedowns as explicit lifecycle operations. Identity-changing edits never overwrite an existing live release.</p>
        </div>
        <form action={syncDistributionStatus}>
          <input type="hidden" name="release_id" value={id} />
          <button className="button" type="submit">Refresh store status</button>
        </form>
      </div>

      {updateMode.active ? <div className="distribution-form-block distribution-correction-guide">
        <span className="section-label">Correction mode</span>
        <h3>Correct the existing distributed release</h3>
        <p>Ensemblis has locked the live release identity to submission version {updateMode.baselineVersion}. UPC, track order, ISRCs and master audio cannot change in place.</p>
        <ol>
          <li>Edit the allowed canonical metadata, rights, artist mapping or credits above.</li>
          <li>Use <strong>Synchronize package</strong> to update the same provider release while preserving provider track/audio IDs.</li>
          <li>Run <strong>full preflight</strong> again.</li>
          <li>Use the existing final approval to resend the correction only to the originally delivered services.</li>
        </ol>
      </div> : stableForCorrection ? <div className="distribution-form-block distribution-correction-start">
        <div><h3>Need to correct a distributed release?</h3><p>Start a guarded correction to unlock safe metadata editing. Ensemblis first reconciles the provider-assigned UPC/ISRCs and blocks any identity-changing edit that requires a takedown + new release.</p></div>
        <form action={beginDistributionUpdate}>
          <input type="hidden" name="release_id" value={id} />
          <button className="button" type="submit" disabled={hasAnyUnresolvedOperation}>Start correction</button>
        </form>
        {hasAnyUnresolvedOperation ? <small className="distribution-muted">Resolve the outstanding external operation before starting a correction.</small> : null}
      </div> : null}

      {unresolvedTakedown ? <div className="distribution-feedback error" role="alert"><strong>Reconciliation required</strong><span>A previous takedown has an uncertain provider result. Refresh status or resolve it in Distribution Operations before another removal request.</span></div> : null}

      {eligible.length ? <form action={requestDistributionTakedown} className="distribution-form distribution-takedown-form">
        <input type="hidden" name="release_id" value={id} />
        <div className="distribution-form-block">
          <h3>Choose services to remove</h3>
          <p>Only services with a delivered, live, rejected or provider-error state are eligible. Services already in takedown are intentionally excluded.</p>
          <div className="distribution-checkboxes">
            {eligible.map((delivery) => <label key={delivery.id}>
              <input type="checkbox" name="store_id" value={delivery.store_id} disabled={unresolvedTakedown || updateMode.active} />
              <span><strong>{delivery.store_name}</strong><small>{delivery.state.replaceAll("_", " ")}{delivery.provider_status ? ` · provider ${delivery.provider_status}` : ""}</small></span>
            </label>)}
          </div>
        </div>
        <label className="distribution-final-confirm">
          <input type="checkbox" name="confirm_takedown" disabled={unresolvedTakedown || updateMode.active} />
          I understand this requests removal from the selected music services and explicitly approve the takedown.
        </label>
        <div className="actions">
          <button className="button" type="submit" disabled={unresolvedTakedown || updateMode.active}>Request takedown</button>
          <span className="distribution-muted">The provider dry-run must pass before any destructive request is sent. Finish or reconcile an active correction first.</span>
        </div>
      </form> : <div className="distribution-form-block"><h3>No stores currently eligible for a new takedown</h3><p className="distribution-muted">If a removal is already in progress, refresh provider status until each selected service confirms removal.</p></div>}
    </section>
  </div>;
}
