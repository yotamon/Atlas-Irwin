"use client";

import { useMemo, useState } from "react";
import { updateVideoProductionProfile } from "@/app/studio/video-profile-actions";
import { SubmitButton } from "@/components/studio/submit-button";
import {
  VIDEO_PRODUCTION_PROFILE_DEFINITIONS,
  VIDEO_PRODUCTION_PROFILES,
  type VideoProductionProfile,
  type VideoProductionProfilePreview,
} from "@/lib/video-director/production-profile";

function money(value: number | null) {
  return value === null
    ? null
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function credits(value: number) {
  return `${Number(value || 0).toFixed(1)} cr`;
}

function estimate(preview: VideoProductionProfilePreview | null) {
  if (!preview) return "Planning required";
  if (preview.expectedUsd !== null) {
    const expected = money(preview.expectedUsd);
    const reserve = money(preview.reserveUsd);
    return reserve && reserve !== expected ? `${expected} expected · ${reserve} reserved max` : expected;
  }
  return `${credits(preview.expectedCredits)} expected · ${credits(preview.reserveCredits)} reserve`;
}

export function ProductionProfileControl({
  projectId,
  initialProfile,
  initialMaxBudgetUsd,
  previews,
  profileLocked,
}: {
  projectId: string;
  initialProfile: VideoProductionProfile;
  initialMaxBudgetUsd: number | null;
  previews: VideoProductionProfilePreview[];
  profileLocked: boolean;
}) {
  const initialIndex = Math.max(0, VIDEO_PRODUCTION_PROFILES.indexOf(initialProfile));
  const [index, setIndex] = useState(initialIndex);
  const [maxBudget, setMaxBudget] = useState(initialMaxBudgetUsd === null ? "" : String(initialMaxBudgetUsd));
  const profile = VIDEO_PRODUCTION_PROFILES[index] ?? "balanced";
  const definition = VIDEO_PRODUCTION_PROFILE_DEFINITIONS[index] ?? VIDEO_PRODUCTION_PROFILE_DEFINITIONS[2];
  const preview = previews.find((item) => item.profile === profile) ?? null;
  const parsedMax = maxBudget.trim() ? Number(maxBudget) : null;
  const expectedUsd = preview?.expectedUsd ?? null;
  const overCap = expectedUsd !== null
    && parsedMax !== null
    && Number.isFinite(parsedMax)
    && expectedUsd > parsedMax;
  const capDifference = overCap && parsedMax !== null ? expectedUsd - parsedMax : 0;
  const hasRouting = Boolean(preview?.shots.length);

  const estimateLabel = useMemo(() => estimate(preview), [preview]);

  return (
    <section className="video-production-control" aria-labelledby="production-quality-title">
      <div className="video-production-control__head">
        <div>
          <span className="section-label">Quality + cost control</span>
          <h3 id="production-quality-title">Choose how Ensemblis spends quality</h3>
          <p>The setting changes the exact model routing. Nothing is hidden: provider, model and expected spend stay visible before generation.</p>
        </div>
        <div className="video-production-estimate" data-over-cap={overCap || undefined}>
          <small>Estimated production</small>
          <strong>{estimateLabel}</strong>
          <span>{preview?.pricingAvailable ? "USD estimate from configured provider pricing" : "USD conversion unavailable · provider credits shown"}</span>
        </div>
      </div>

      <form action={updateVideoProductionProfile} className="video-production-control__form">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="production_profile" value={profile} />

        <div className="video-quality-slider">
          <div className="video-quality-slider__labels" aria-hidden="true">
            {VIDEO_PRODUCTION_PROFILE_DEFINITIONS.map((item, itemIndex) => (
              <button
                type="button"
                key={item.id}
                className={itemIndex === index ? "active" : ""}
                onClick={() => !profileLocked && setIndex(itemIndex)}
                tabIndex={-1}
              >
                <span>{item.eyebrow}</span>
                <strong>{item.label}</strong>
              </button>
            ))}
          </div>
          <input
            aria-label="Production quality"
            type="range"
            min={0}
            max={VIDEO_PRODUCTION_PROFILES.length - 1}
            step={1}
            value={index}
            disabled={profileLocked}
            onChange={(event) => setIndex(Number(event.target.value))}
          />
          <div className="video-quality-slider__selection">
            <div><span>{definition.eyebrow}</span><strong>{definition.label}</strong></div>
            <p>{definition.description}</p>
            {profileLocked ? <small>Global routing is locked because motion generation has started. Existing spend stays auditable; future shots can still be handled individually.</small> : null}
          </div>
        </div>

        <div className="video-production-model-plan">
          <div className="video-production-model-plan__head">
            <div><span className="section-label">Exact routing preview</span><h4>{hasRouting ? "Models this setting will use" : "Model routing appears after the storyboard"}</h4></div>
            {preview ? <span>{preview.shots.length} paid source shot{preview.shots.length === 1 ? "" : "s"}</span> : null}
          </div>
          {hasRouting && preview ? (
            <>
              <div className="video-model-mix">
                {preview.modelMix.map((item) => (
                  <article key={`${item.provider}:${item.model}`}>
                    <div className="video-model-mix__identity">
                      <span>{item.providerLabel}</span>
                      <strong>{item.modelLabel}</strong>
                    </div>
                    <div className="video-model-mix__share" aria-label={`${item.share}% of generated footage`}>
                      <span style={{ width: `${Math.max(3, item.share)}%` }} />
                    </div>
                    <dl>
                      <div><dt>Footage</dt><dd>{item.share}%</dd></div>
                      <div><dt>Shots</dt><dd>{item.shotCount}</dd></div>
                      <div><dt>Estimate</dt><dd>{money(item.expectedUsd) ?? credits(item.expectedCredits)}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>

              <details className="video-shot-routing-disclosure">
                <summary>See the exact model for every paid shot</summary>
                <div className="video-shot-routing-list">
                  {[...preview.shots].sort((a, b) => a.displayOrder - b.displayOrder).map((shot) => (
                    <article key={shot.shotId}>
                      <span className="video-shot-routing-list__number">{String(shot.displayOrder + 1).padStart(2, "0")}</span>
                      <div className="video-shot-routing-list__model">
                        <small>{shot.providerLabel}</small>
                        <strong>{shot.modelLabel}</strong>
                        <span>{shot.generationSeconds}s generation · {money(shot.expectedUsd) ?? credits(shot.expectedCredits)}</span>
                      </div>
                      <p>{shot.reason}</p>
                      <div className="video-shot-routing-list__alternatives">
                        <small>Alternatives</small>
                        {shot.alternatives.map((item) => (
                          <span key={`${item.provider}:${item.model}`}>{item.modelLabel} · {item.providerLabel}</span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <div className="video-production-routing-empty">
              <strong>No paid motion has been planned yet.</strong>
              <p>Ensemblis will apply this profile when the production plan is created, then show the exact provider and model for every shot before you approve spend.</p>
            </div>
          )}

          <details className="video-profile-comparison">
            <summary>Compare all quality settings and their model mix</summary>
            <div className="video-profile-comparison__grid">
              {previews.map((item) => (
                <article key={item.profile} data-selected={item.profile === profile || undefined}>
                  <div><small>{VIDEO_PRODUCTION_PROFILE_DEFINITIONS.find((definitionItem) => definitionItem.id === item.profile)?.eyebrow}</small><strong>{item.label}</strong></div>
                  <span>{estimate(item)}</span>
                  {item.modelMix.length ? (
                    <ul>
                      {item.modelMix.map((model) => (
                        <li key={`${model.provider}:${model.model}`}><strong>{model.modelLabel}</strong><span>{model.providerLabel} · {model.share}%</span></li>
                      ))}
                    </ul>
                  ) : <p>Exact model mix becomes available after storyboard planning.</p>}
                </article>
              ))}
            </div>
          </details>
        </div>

        <div className="video-budget-cap">
          <div>
            <label htmlFor={`video-max-budget-${projectId}`}>Maximum spend <span>optional</span></label>
            <p>This is a ceiling, not the creative brief. Quality still drives routing; the cap prevents accidental overspend.</p>
          </div>
          <div className="video-budget-cap__input">
            <span>$</span>
            <input
              id={`video-max-budget-${projectId}`}
              name="max_budget_usd"
              type="number"
              min="1"
              max="100000"
              step="1"
              inputMode="decimal"
              placeholder="No USD cap"
              value={maxBudget}
              onChange={(event) => setMaxBudget(event.target.value)}
            />
          </div>
          <div className="video-budget-cap__state" data-over-cap={overCap || undefined}>
            {overCap ? (
              <><strong>Current profile is about {money(capDifference)} over this cap.</strong><span>Move the quality control left or raise the ceiling before approving generation.</span></>
            ) : parsedMax !== null && Number.isFinite(parsedMax) ? (
              <><strong>Within your {money(parsedMax)} ceiling.</strong><span>Every paid batch still requires explicit approval.</span></>
            ) : (
              <><strong>No USD ceiling.</strong><span>The provider credit safety cap and approval envelopes still protect spend.</span></>
            )}
          </div>
        </div>

        <div className="video-production-control__actions">
          <div>
            <strong>What changes when you save?</strong>
            <span>{profileLocked ? "The USD ceiling can change; completed/global routing stays fixed." : "Unspent storyboard shots are re-routed immediately. No generation is submitted."}</span>
          </div>
          <SubmitButton pendingLabel="Updating production plan...">Save quality + cost settings</SubmitButton>
        </div>
      </form>
    </section>
  );
}
