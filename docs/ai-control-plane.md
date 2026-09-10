# Atlas AI Control Plane

The Atlas AI Control Plane is the application-owned policy, telemetry, quality and learning layer above Vercel AI Gateway.

Vercel AI Gateway owns inference transport, provider routing and technical fallback. Atlas owns task meaning, model policy, budget limits, product quality, semantic escalation and evidence-based routing decisions.

## Architecture

```text
Studio / automation
       |
       v
runAtlasAiTask()
       |
       +--> task registry
       +--> routing mode / task overrides
       +--> evidence-gated adaptive route ordering
       +--> monthly + text budget preflight
       +--> generation_runs attempt ledger
       |
       v
Vercel AI Gateway
       |
       +--> provider routing
       +--> technical fallback
       |
       v
structured result
       |
       v
deterministic quality gate
       |
       +--> pass --> accept result
       |
       +--> fail --> semantic escalation route --> gate again

Later Studio choices and performance
       |
       v
ai_feedback_events
       |
       +--> Control Center analytics
       +--> adaptive routing evidence
```

## Core boundaries

- `lib/ai/gateway.ts`: transport only. Auth, request shape, provider sorting, technical fallbacks and raw usage metadata.
- `lib/ai/tasks.ts`: task registry. Defines default tier, configured model route, escalation route and quality threshold.
- `lib/ai/learning.ts`: evidence-gated adaptive ordering inside the approved task route.
- `lib/ai/control-plane.ts`: canonical execution path. Enforces budgets, resolves the effective route, writes attempt telemetry, evaluates quality and performs semantic escalation.
- `lib/ai/quality.ts`: deterministic quality-gate primitives.
- `lib/ai/analytics.ts`: cost, quality, routing, learning and human-signal aggregation for Studio.
- `lib/ai/feedback.ts`: explicit feedback helpers. Database triggers cover durable domain-level signals.

Do not put product routing semantics in the Gateway adapter. Do not bypass `runAtlasAiTask()` for ordinary text/reasoning inference.

## Task registry

Current tasks:

| Task | Default tier | Semantic escalation |
| --- | --- | --- |
| `marketing.campaign_plan` | balanced | premium |
| `marketing.caption` | economy | balanced |
| `marketing.strategy` | balanced | premium |
| `metadata.extraction` | economy | balanced |
| `video.concepts` | premium | none |
| `video.production_plan` | premium | none |
| `video.shot_revision` | balanced | premium |

The owner-level routing mode may stay on `auto` or force economy, balanced or premium. A forced mode is an explicit decision and disables learned reordering and semantic tier escalation.

Task-specific overrides live in `ai_control_settings.task_overrides`.

## Adaptive routing

Adaptive routing is active only when routing mode is `auto`.

It is intentionally conservative:

- 90-day evidence lookback
- at least 6 completed samples for a candidate model
- at least 3 human-rated samples
- average human quality of at least 0.72
- deterministic gate quality must satisfy the task threshold, capped at the 0.90 learning floor
- only models already present in `policy.models` may be reordered
- eligible models are ordered by observed cost, then human quality

If there is not enough evidence, Atlas keeps the configured route. If learning does not change the order, the configured route remains effective. Forced Economy, Balanced or Premium modes always win over learned routing.

The effective route decision is visible in `/studio/settings/ai`, including whether learning was applied and why. Every generation attempt also records the configured route, effective route and adaptive decision in `generation_runs.metadata`.

Adaptive routing does not create new model IDs, cross task-policy boundaries or modify specialist media providers.

## Technical fallback vs semantic escalation

These are different events.

A **technical fallback** happens inside Vercel AI Gateway when the requested route cannot be served and a configured fallback is used. Atlas records `fallback_used` on the attempt.

A **semantic escalation** happens after a technically successful response fails a deterministic Atlas quality gate. Atlas marks the root run as escalated and creates a second `generation_runs` row linked with `parent_run_id`.

Adaptive routing happens before both: it can reorder the approved first-pass route based on accumulated evidence.

Never use semantic retries for paid specialist media submission.

## Telemetry

`generation_runs` is the canonical request-attempt ledger. A row is opened before inference and completed or failed afterward.

It records:

- task, purpose and prompt version
- campaign, release and video-project lineage
- configured/requested/resolved model information
- routed provider
- Gateway request/generation IDs
- latency
- input/output token counts
- recorded cost
- technical fallback state
- parent attempt and semantic escalation state
- deterministic quality pass, score and failures
- latest user outcome and edit ratio
- route, budget and adaptive-learning metadata present at request start

Human-quality analytics use the full `ai_feedback_events` stream because one generation may create multiple reviewable outputs with different outcomes.

## Budget policy

`ai_control_settings` stores owner-level policy. Defaults:

- monthly AI budget: $30
- text/reasoning budget: $10
- image policy target: $8
- video policy target: $12
- hard stop: enabled
- deterministic quality escalation: enabled
- Gateway provider sort: cost

The Control Plane enforces monthly and text/reasoning budgets for language inference. Specialist image/video values remain policy targets because those providers keep their own quote, approval, reservation and hard-credit systems.

When `hard_stop` is enabled, a new attempt is refused before inference once the relevant recorded budget is exhausted. Semantic escalation checks budget again before the stronger attempt.

## Quality gates

Quality is product-defined and deterministic wherever practical. The generating model does not self-grade its own result.

Campaign planning checks strategy depth, content focus, duplicates, connected-channel boundaries, experiment uniqueness, usable variants and experiment-to-moment linkage.

Video concepts check treatment depth, concept distinctness and timeline validity.

Video production plans reuse the strict storyboard timeline validator and check look-development coverage, visual-bible depth, executable prompts and source-shot availability.

Shot revisions validate timing, prompt usefulness and vertical metadata.

## Human and performance learning

`ai_feedback_events` stores granular evidence through domain-level database triggers.

Signals include:

- content variant approved -> accepted
- content variant rejected -> rejected
- generated content changed -> edited
- generated content published -> published
- video concept selected -> accepted
- video production plan approved -> accepted
- newer comparable generation -> regenerated
- performance snapshots -> performance evidence

Adaptive routing uses human quality signals only after minimum-sample safeguards are satisfied. Performance evidence is retained for analysis but is not currently allowed to silently reorder language models by itself.

## Studio Control Center

`/studio/settings/ai` exposes:

- Control Plane health
- monthly/text spend and guardrails
- request and deterministic quality rates
- first-pass quality
- semantic escalations and Gateway technical fallbacks
- active adaptive routes
- token use and latency
- human acceptance/edit/reject/regenerate/publish signals
- task-level cost and quality
- model-level cost and failures
- configured task registry
- effective adaptive routes and evidence decisions
- routing/budget controls
- recent attempt trace

Secrets are never rendered on this page.

## Specialist media boundary

Higgsfield, BFL/FLUX, Google image/video, Z.AI Vidu, fal.ai, MiniMax Music, ElevenLabs Music and other paid asynchronous specialist adapters stay outside automatic semantic retry unless a future implementation can preserve all of these guarantees:

1. quote before spend
2. explicit approval where required
3. budget/credit reservation
4. idempotent submission
5. safe handling of ambiguous remote submission state
6. reconciliation of actual spend/results

The Control Plane may own more policy and analytics for those operations later, but it must never turn an uncertain paid media request into an automatic duplicate spend.

## Operational rules

- Keep `AI_GATEWAY_API_KEY` server-only for local/non-Vercel runtimes. Vercel production may use OIDC.
- Do not use a GLM Coding Plan key for Atlas application inference.
- Keep task semantics in Atlas, not provider-specific code.
- Prefer deterministic validation before model-as-judge evaluation.
- Adaptive routing must remain evidence-gated and constrained to approved task routes.
- Treat Vercel observability as infrastructure/provider telemetry and Atlas `generation_runs` + `ai_feedback_events` as product telemetry.
