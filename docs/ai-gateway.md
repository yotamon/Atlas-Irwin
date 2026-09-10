# Atlas AI Gateway

Atlas uses Vercel AI Gateway as the default inference backbone for text, reasoning and structured generation.

The Gateway is infrastructure, not product intelligence. Atlas continues to own task intent, quality tiers, budgets, prompts, schemas and approval rules. Specialist media providers stay behind Atlas provider adapters and may continue to use their direct APIs when that gives us better capability, cost transparency or spend safety.

## Architecture

```text
Atlas product logic
  -> Atlas AI policy
     -> task + quality + budget + schema
        -> lib/ai/gateway.ts
           -> Vercel AI Gateway
              -> selected model
                 -> provider routing / fallback

Specialist media routes
  -> Atlas creative provider router
     -> Higgsfield / Google media / BFL / Z.AI Vidu / fal.ai directly
```

This boundary is deliberate. Business logic should never depend on a Gateway-specific SDK object, provider response shape or dashboard setting.

## Why the shared client uses the HTTP API

Atlas calls the Gateway OpenResponses-compatible HTTP endpoint from `lib/ai/gateway.ts` instead of coupling application code to a Vercel SDK.

That gives Atlas:

- one small provider-neutral adapter
- no additional runtime dependency or lockfile churn
- strict structured-output support
- model fallback and provider routing
- Gateway request/cost metadata
- an easy future path to replace the Gateway implementation without changing Campaign Brain or Video Director

The transport can move to Vercel AI SDK later if it provides a concrete product benefit. The domain contract should stay unchanged.

## Authentication

### Vercel deployments

Production and preview deployments use the Vercel-provided `VERCEL_OIDC_TOKEN`. Do not create, copy or persist this token manually.

The shared client checks credentials in this order:

1. `AI_GATEWAY_API_KEY`
2. `VERCEL_OIDC_TOKEN`

This means an explicit Gateway API key can be used for local development or a non-Vercel runtime while Vercel deployments work without a manually managed Gateway secret.

### Local development

Create a Vercel AI Gateway API key and add it only to `.env.local`:

```env
AI_GATEWAY_API_KEY=...
```

Never expose it as a `NEXT_PUBLIC_*` variable.

## Model IDs

Atlas stores Gateway-native model IDs in `provider/model` form, for example:

```text
openai/gpt-5.6-sol
google/gemini-3.7-flash
zai/glm-4.7-flash
```

`normalizeGatewayModel()` keeps a small compatibility layer for existing Atlas settings. In particular, legacy `gpt-5.6` is normalized to `openai/gpt-5.6-sol`.

Do not add speculative model IDs. A new model should be verified against the current Gateway catalog before it becomes an Atlas default.

## Routing responsibilities

### Atlas decides

Atlas decides what kind of work is being done and what quality/cost policy it deserves.

Examples:

```text
marketing economy
marketing balanced
marketing premium
video creative direction
```

### Gateway decides

For the selected model route, Vercel AI Gateway handles provider-level routing and the ordered fallback model list supplied by Atlas.

`ATLAS_AI_GATEWAY_PROVIDER_SORT` controls same-model provider selection:

```env
ATLAS_AI_GATEWAY_PROVIDER_SORT=cost
```

Supported Atlas values are:

- `cost` - default, optimize provider selection for cost
- `ttft` - optimize time to first token
- `tps` - optimize throughput

Changing this value must not change product quality tiers or approval semantics.

## Marketing policy

Campaign Brain keeps the existing `economy`, `balanced` and `premium` product presets. They are now ordered model routes rather than hand-written provider clients.

Defaults:

```text
economy
  1. zai/glm-4.7-flash
  2. zai/glm-4.7-flashx
  3. google/gemini-3.7-flash
  4. openai/gpt-5.6-sol

balanced
  1. google/gemini-3.7-flash
  2. openai/gpt-5.6-sol
  3. zai/glm-4.7-flashx

premium
  1. openai/gpt-5.6-sol
  2. google/gemini-3.7-flash
  3. zai/glm-4.7-flashx
```

The routes can be overridden without a deploy by setting comma-separated model lists:

```env
ATLAS_MARKETING_ECONOMY_MODELS=
ATLAS_MARKETING_BALANCED_MODELS=
ATLAS_MARKETING_PREMIUM_MODELS=
```

`ATLAS_MARKETING_MODEL` remains a backward-compatible premium OpenAI model override.

## Video Creative Director policy

Video concept generation, production-plan generation and shot revision use the same Gateway client.

The Director deliberately has no guessed paid default:

```env
VIDEO_DIRECTOR_LLM_MODEL=openai/gpt-5.6-sol
VIDEO_DIRECTOR_LLM_FALLBACK_MODELS=google/gemini-3.7-flash,zai/glm-4.7-flashx
```

The primary model must be selected explicitly. Fallbacks are optional.

The existing `OpenAIMusicVideoDirector` class name is temporarily preserved to avoid a broad migration of Studio actions. Its inference transport is now provider-neutral despite the legacy class name.

## Structured output contract

Gateway-backed Atlas features request strict JSON Schema output. Callers pass:

```text
name
schema
instructions
input
primary model
fallback models
```

`lib/ai/gateway.ts` owns transport, error handling, timeout, refusal detection, JSON parsing and Gateway metadata extraction.

Callers should not parse provider-specific response bodies.

## Observability

Every Gateway result can surface:

- requested model
- resolved response model
- request ID
- Gateway generation ID when returned
- routed provider when returned
- estimated Gateway cost when returned

Existing domain logging should persist the useful values at the feature boundary. The Gateway dashboard is operational observability, not a replacement for Atlas generation lineage.

## Timeouts

Standard Gateway calls default to 90 seconds:

```env
ATLAS_AI_GATEWAY_TIMEOUT_MS=90000
```

The accepted range is 5 to 300 seconds. Video Creative Director structured planning explicitly allows up to 180 seconds because its schemas and context can be substantially larger.

A timeout is surfaced as a real failure. Atlas does not silently claim that a timed-out generation succeeded.

## Specialist provider boundary

The following remain direct unless we intentionally migrate them later:

```text
Higgsfield
Google image / Veo media generation
Black Forest Labs
Z.AI Vidu
fal.ai
MiniMax Music
ElevenLabs Music
Media Worker
```

Why:

- provider-specific media capabilities matter
- asynchronous generation/polling contracts differ
- Atlas has explicit quote/reserve/approval/settlement safety around paid media
- direct adapters make ambiguous submission state visible
- a generic Gateway should not weaken existing spend controls

A future migration of a media route must preserve those invariants before changing transport.

## Failure model

Gateway fallback is allowed for text/reasoning because a failed attempt has no Atlas media reservation state to reconcile.

Paid creative media is different. Atlas must never blindly retry a potentially submitted paid generation through another provider. Existing specialist adapters therefore keep their definite-rejection vs ambiguous-submission semantics.

## Rollout checklist

Before merging a Gateway change:

1. `npm run test:studio`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run build`
5. Confirm Marketing has no direct OpenAI/Google/Z.AI chat endpoint.
6. Confirm Video Creative Director has no direct OpenAI endpoint.
7. Confirm specialist creative providers are still direct.
8. Verify one local Gateway structured request with `AI_GATEWAY_API_KEY` when credentials are available.
9. Verify one Vercel preview request using OIDC before production promotion.
10. Check model, request ID and cost metadata in the resulting generation record/log.

## Rollback

The Gateway is isolated behind `lib/ai/gateway.ts`. If the transport must change, replace that adapter or restore the previous feature adapter implementation. Do not push Gateway-specific concerns upward into Campaign Brain, Video Director domain types or UI components.

This isolation is also what keeps an OpenRouter or self-hosted gateway migration possible later without redesigning Atlas.
