# Atlas Marketing Intelligence Engine

Atlas Marketing Intelligence turns release marketing into a measured feedback loop rather than a static content checklist.

## Product contract

The release remains the canonical music/catalog object. A campaign is the marketing strategy and execution system around that release.

```text
Release
  -> Campaign Brain
     -> release-relative phases
     -> experiments
        -> content moments
        -> creative variants
        -> attribution links
     -> approval gates
     -> publication jobs
     -> metric snapshots
     -> experiment evaluation
     -> proposed learnings
     -> approved marketing memory
```

Music Lab and Video Director stay specialist production tools. Campaign Brain owns why an asset should exist, what hypothesis it serves, when it should ship, and what signal decides whether the idea worked.

## Automation modes

### Suggest

Atlas plans and recommends. Consequential execution remains manual.

### Assisted

This is the default. Atlas may prepare drafts, schedules, derivatives, publication handoffs, outreach follow-ups, and analysis, but human approval gates remain in front of consequential actions.

### Autopilot

Safe internal jobs can advance without an approval gate. Channel publishing is still limited by the capabilities of the authenticated channel adapter. An adapter must never report a post as published unless the platform returned a real publication result.

## Campaign phases

Default phases are relative to release day, not hard-coded calendar dates:

| Phase | Window | Default job |
| --- | ---: | --- |
| Discovery | T-21 to T-10 | Qualified reach |
| Hook testing | T-9 to T-4 | Test framing and saves |
| Anticipation | T-3 to T-1 | Profile intent |
| Launch | T0 to T+2 | Smart-link and stream intent |
| Momentum | T+3 to T+14 | Follows, selector discovery, social proof |
| Catalog revival | T+21 to T+45 | Rediscovery and streaming intent |

When a release date changes, the database trigger updates campaign anchors, phase windows, and all unfinished content that still has `schedule_locked = false`.

## Experiments and variants

A `campaign_experiment` represents one testable hypothesis. Each experiment owns two or three `content_variants` that should change one meaningful framing variable, such as the first-second hook, listener promise, or audience angle.

The winner logic uses:

- a minimum qualified sample per variant
- a goal-specific primary signal
- a minimum relative lift over the runner-up

If there is not enough sample, the experiment stays in evaluation. If the lift is below the threshold, the result is inconclusive. A winner creates a proposed learning and may queue winner derivatives.

## Goal-specific scoring

There is no universal content score. Atlas evaluates a piece against its intended job.

Examples:

- Reach: distribution volume plus sharing and retention quality
- Saves: save rate, sharing, and watch quality
- Follows: follow conversion plus profile intent
- Streams: link click rate, streams per reach, and playlist-add quality
- Community: meaningful comments, saves, and shares
- DJ Discovery: selector-action proxy from high-intent saves, shares, and clicks

Legacy weighted scoring remains available only for older release views that do not provide a goal.

## AI planning

Campaign planning is an explicit action and never spends on page load.

Structured text generation is routed through the shared Vercel AI Gateway adapter in `lib/ai/gateway.ts`. Campaign Brain still owns the product-level `economy`, `balanced` and `premium` policies. The Gateway handles provider routing and ordered model fallback for the route Atlas selects.

The prompt includes:

- release identity and story
- sonic and emotional hook
- visual direction
- brand settings
- approved structured learnings
- legacy release learnings
- historical content performance
- the selected campaign objective

If Gateway-backed AI planning is unavailable, Atlas falls back to an adaptive release-specific planner. It does not fall back to the old fixed 11-item content template.

Each successful AI run can record provider/gateway identity, resolved model, prompt version, input context, output, request ID, generation ID and cost metadata where available. Atlas generation lineage remains the source of truth even though Vercel also provides operational Gateway observability.

Default model routes preserve the existing value-for-money policy:

```text
economy
  zai/glm-4.7-flash
  -> zai/glm-4.7-flashx
  -> google/gemini-3.7-flash
  -> openai/gpt-5.6-sol

balanced
  google/gemini-3.7-flash
  -> openai/gpt-5.6-sol
  -> zai/glm-4.7-flashx

premium
  openai/gpt-5.6-sol
  -> google/gemini-3.7-flash
  -> zai/glm-4.7-flashx
```

See [`ai-gateway.md`](ai-gateway.md) for authentication, routing responsibilities, model overrides and failure semantics.

## Attribution

Campaign links use `/go/<code>`.

The redirect route records clicks server-side and redirects only to an HTTP or HTTPS destination stored in `attribution_links`.

Visitor uniqueness uses a salted SHA-256 hash over a rolling time window. Raw IP addresses are not stored in the attribution tables.

`record_attribution_click` is a service-role-only database function so click counting and unique counting are atomic without exposing marketing tables through anonymous RLS policies.

## Publication jobs

`publication_jobs` are provider-neutral. Channel adapters implement a small contract for publishing and metric collection.

Until a first-party authenticated social adapter exists, the built-in adapter returns `manual_ready`. This means:

1. Atlas prepares copy, asset reference, schedule, and tracked link.
2. The UI presents the exact handoff.
3. The user publishes it on the platform.
4. The user confirms the external post ID or URL.
5. Metric collection can use that external identity once an adapter supports it.

Atlas never converts a manual handoff into a fake `published` result.

## Outreach sequences

Outreach automation is approval-first.

A sequence contains ordered steps with delays. When a step is due, Atlas creates an `outreach_messages` draft and pauses the enrollment. It does not send the draft.

After the user reviews and sends the message, `I sent this` records the send time and schedules the next step. A reply or terminal response stops the enrollment automatically.

This preserves the existing CRM while removing the burden of remembering follow-up timing.

## Event and job system

Database triggers emit durable marketing events for important cross-system changes such as:

- `content.published`
- `metrics.updated`

The cron processor converts events into idempotent jobs. Jobs are claimed with `FOR UPDATE SKIP LOCKED` to avoid two cron invocations running the same unit of work concurrently.

Failed jobs use bounded exponential backoff and a maximum attempt count.

## Cron

`vercel.json` runs `/api/cron/marketing` once per day by default. The endpoint requires `Authorization: Bearer <CRON_SECRET>`.

The same cycle can be triggered manually from Campaign Brain for immediate testing and operations.

The cycle performs:

1. due publication handoffs / publications
2. due outreach draft generation
3. event ingestion
4. due automation jobs

## Environment

Required for the database-backed engine:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
CRON_SECRET
```

Gateway-backed AI planning on Vercel deployments uses the automatically injected `VERCEL_OIDC_TOKEN`. Local development or non-Vercel runtimes should set:

```text
AI_GATEWAY_API_KEY
```

Optional routing configuration:

```text
ATLAS_MARKETING_TEXT_PRESET=balanced
ATLAS_MARKETING_MODEL=openai/gpt-5.6-sol
ATLAS_MARKETING_ECONOMY_MODELS=
ATLAS_MARKETING_BALANCED_MODELS=
ATLAS_MARKETING_PREMIUM_MODELS=
ATLAS_AI_GATEWAY_PROVIDER_SORT=cost
ATLAS_AI_GATEWAY_TIMEOUT_MS=90000
```

Recommended attribution hardening:

```text
ATTRIBUTION_HASH_SALT=<long random secret>
```

Music Lab and paid creative media providers keep their own direct provider credentials and approval controls.

## Deployment order

1. Apply all Supabase migrations in order.
2. Add required server-only secrets to the deployment environment.
3. Deploy the Next.js application.
4. Confirm Vercel Gateway/OIDC readiness or configure a Gateway key for non-Vercel runtime testing.
5. Create a campaign for a release.
6. Generate a plan and inspect the recorded generation run.
7. Approve a variant and queue publication.
8. Run the automation cycle manually once.
9. Verify the handoff or real adapter result.
10. Add metric snapshots or sync metrics.
11. Evaluate the experiment and approve only learnings that have enough evidence.

## Safety invariants

- No AI call on ordinary page render.
- No cold outreach message is auto-sent.
- No social post is reported as published without a real platform result or explicit user confirmation.
- No experiment winner is declared without minimum sample and lift thresholds.
- No proposed learning becomes planning memory without approval.
- No raw IP address is stored for attribution.
- Release-date changes do not silently orphan unfinished campaign schedules.
- Automation and publication jobs use idempotency/concurrency controls.
- Gateway routing must not bypass Atlas quality tiers, schemas, approval gates or media spend controls.
