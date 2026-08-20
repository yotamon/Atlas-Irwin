# Atlas AI Control Plane

The Atlas AI Control Plane is the application-owned policy, telemetry, quality and learning layer above Vercel AI Gateway.

Vercel AI Gateway owns inference transport, provider routing and technical model fallback. Atlas owns the meaning of a task, its acceptable cost, its quality requirements, semantic escalation and what the artist's later choices teach the system.

## Architecture

```text
Studio / automation
       |
       v
runAtlasAiTask()
       |
       +--> task registry / routing mode
       +--> monthly + text budget preflight
       +--> generation_runs attempt ledger
       |
       v
Vercel AI Gateway
       |
       +--> provider routing
       +--> technical model fallback
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
       v
AI Control Center / future learned routing
```

## Core boundaries

- `lib/ai/gateway.ts`: transport adapter only. Auth, Gateway request shape, provider sorting, technical fallbacks and raw usage metadata.
- `lib/ai/tasks.ts`: task registry. Defines task tier, model route, escalation route and quality threshold.
- `lib/ai/control-plane.ts`: canonical execution path. Enforces budgets, writes attempt telemetry, evaluates quality and performs semantic escalation.
- `lib/ai/quality.ts`: deterministic quality-gate primitives.
- `lib/ai/analytics.ts`: cost, quality, routing and human-signal aggregation for Studio.
- `lib/ai/feedback.ts`: explicit feedback helpers. Database triggers cover the durable domain-level signals.

Do not put product-specific routing logic in the Gateway adapter. Do not bypass `runAtlasAiTask()` for ordinary text/reasoning inference.

## Task registry

Current task types:

| Task | Default tier | Semantic escalation |
| --- | --- | --- |
| `marketing.campaign_plan` | balanced | premium |
| `marketing.caption` | economy | balanced |
| `marketing.strategy` | balanced | premium |
| `metadata.extraction` | economy | balanced |
| `video.concepts` | premium | none |
| `video.production_plan` | premium | none |
| `video.shot_revision` | balanced | premium |

The Studio-level routing mode can leave these rules on `auto` or force all Control Plane tasks to economy, balanced or premium. A forced tier intentionally disables semantic tier escalation because the user has explicitly chosen the tier.

Task-specific JSON overrides live in `ai_control_settings.task_overrides` so future experiments do not require environment-variable churn.

## Technical fallback vs semantic escalation

These are deliberately different concepts.

A **technical fallback** happens inside Vercel AI Gateway when the requested route cannot be served and a configured fallback model is used. It is recorded on the attempt as `fallback_used`.

A **semantic escalation** happens after Atlas receives a technically successful structured response but a deterministic product quality gate rejects it. Atlas marks the root attempt `escalated`, creates a second `generation_runs` row with `parent_run_id`, and runs the stronger route.

Never use semantic retries for paid specialist media submission. Repeating a video/image provider request can spend money twice or create ambiguous remote jobs.

## Telemetry

`generation_runs` is the canonical request-attempt ledger. Every Control Plane call opens a row before external inference and completes or fails that row afterward.

Important fields include:

- task, purpose and prompt version
- campaign, release and video-project lineage
- requested and resolved model
- routed provider
- Gateway request/generation IDs
- start/completion time and latency
- input/output token counts
- estimated/actual recorded cost
- technical fallback state
- parent attempt and semantic escalation state
- deterministic quality pass/score/failures
- latest user outcome and edit ratio
- additional metadata, including the route and budget snapshot present at request start

The Control Center uses the full event stream for human-quality analytics rather than trusting only `generation_runs.user_outcome`, because one generation may produce many pieces of content with different outcomes.

## Budget policy

`ai_control_settings` stores the owner-level policy. Defaults are intentionally conservative:

- monthly AI budget: $30
- text/reasoning budget: $10
- image policy target: $8
- video policy target: $12
- hard stop: enabled
- deterministic quality escalation: enabled
- provider sort: cost

Control Plane v1 enforces the monthly and text/reasoning budgets for language inference. Image/video values are visible policy targets only. Specialist media still uses its own quote, approval, reservation and hard-credit safeguards.

When `hard_stop` is enabled, a new attempt is refused before external inference if the relevant budget is already exhausted. Semantic escalation performs a fresh budget check before the stronger attempt.

## Quality gates

Quality is product-defined and deterministic wherever practical. Models do not self-grade their own output.

Campaign planning currently checks, among other constraints:

- meaningful strategy summary
- focused amount of content
- no duplicate moments
- only connected social channels
- unique experiments
- usable variant counts/content
- correct experiment-to-moment linkage

Video concepts check treatment depth, concept distinctness and valid timeline moments.

Video production plans reuse the strict storyboard timeline validator and also check look-development coverage, visual-bible depth, executable prompts and the existence of actual source shots.

Shot revisions validate timing, prompt usefulness and vertical metadata.

## Human and performance learning

`ai_feedback_events` records granular evidence. Database triggers keep this coupled to domain changes rather than a particular UI implementation.

Current signals include:

- content variant approved -> accepted
- content variant rejected -> rejected
- generated content fields changed -> edited with an approximate changed-field ratio
- generated content published -> published
- video concept selected -> accepted
- video production plan approved -> accepted
- a newer generation replaces an older comparable one -> regenerated
- content/variant performance snapshots -> performance evidence

These events are intentionally raw evidence. Control Plane v1 reports their aggregates but does not yet let a small sample silently rewrite model policy. Future adaptive routing must use minimum-sample and confidence safeguards.

## Studio Control Center

`/studio/settings/ai` exposes:

- Control Plane health
- monthly/text spend and guardrails
- request success and deterministic quality rates
- first-pass quality and semantic escalations
- technical model fallbacks
- token use and latency
- human acceptance/edit/reject/regenerate/publish signals
- performance-sample count
- task-level cost and quality
- model-level cost and failures
- effective task registry routes
- routing/budget controls
- recent attempt trace

Secrets are never rendered in this page.

## Specialist media boundary

Higgsfield, BFL/FLUX, Google image/video, Z.AI Vidu, fal.ai, MiniMax Music, ElevenLabs Music and other paid asynchronous specialist adapters stay outside the semantic retry loop unless a future migration can preserve all of these guarantees:

1. quote before spend
2. explicit approval where required
3. budget/credit reservation
4. idempotent submission
5. safe handling of ambiguous remote submission state
6. reconciliation of actual spend/results

The Control Plane may eventually own policy and analytics for those operations, but it must never turn an uncertain paid media request into an automatic retry.

## Operational rules

- Keep `AI_GATEWAY_API_KEY` server-only for local/non-Vercel runtimes. Vercel production uses OIDC.
- Do not use a GLM Coding Plan key for Atlas application inference.
- Keep task semantics in Atlas, not in provider-specific code.
- Prefer deterministic validation before adding model-as-judge evaluation.
- Store evidence first. Only automate learned routing after enough samples exist to support the decision.
- Treat the Vercel dashboard as provider/infrastructure observability and Atlas `generation_runs` + `ai_feedback_events` as product observability.
