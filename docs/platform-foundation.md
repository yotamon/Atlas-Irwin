# Ensemblis Platform Foundation

This document records the platform-level boundaries that keep Ensemblis observable, provider-neutral and safe as the product grows.

## Execution context and observability

Server-side operations may run inside an `ExecutionContext` from `lib/observability/execution-context.ts`.

The context has one stable `traceId` and optional domain lineage:

- `workspaceId`
- `artistId`
- `trackId`
- `releaseId`
- `jobId`
- `provider`
- `model`
- `operation`
- `estimatedCostUsd`

`observeExecution()` emits structured JSON start/completion/failure events with duration. The context is stored with `AsyncLocalStorage`, so nested provider calls can inherit the same trace without threading log metadata through every function signature.

Incoming HTTP requests can supply `x-ensemblis-trace-id`. Media Worker callbacks recover the same trace from the `ensemblis_trace_id` query parameter added by the dispatcher. Invalid or missing trace IDs are replaced with a generated UUID.

## Media Worker provider boundary

Heavy media work must enter through `lib/media-worker/dispatcher.ts`.

The current provider is `vercel_sandbox`, selected by:

```env
ENSEMBLIS_MEDIA_WORKER_PROVIDER=vercel_sandbox
```

The dispatcher owns provider selection, trace propagation and dispatch-level instrumentation. Callers such as the shared media queue, Active Mastering and AutoMix must not import the Sandbox dispatch function directly.

The Sandbox module still owns Sandbox-specific lifecycle concerns such as callback credentials, readiness and cleanup. This lets Ensemblis introduce a future pool or dedicated compute provider without changing product-domain queues.

## Email provider boundary

Transactional email enters through `lib/email/provider.ts`. The production provider is Resend.

Required configuration:

```env
RESEND_API_KEY=re_...
ENSEMBLIS_EMAIL_FROM=Ensemblis <notifications@example.com>
```

The public Atlas contact form additionally uses `CONTACT_EMAIL_TO`. `CONTACT_EMAIL_FROM` can override the sender for that surface while retaining `ENSEMBLIS_EMAIL_FROM` as the platform default.

The Resend adapter uses the documented HTTP API directly so email delivery does not add another runtime SDK dependency. It propagates the Ensemblis trace header and supports idempotency keys, reply-to, headers and tags through the provider contract.

## Catalog action boundary

`app/studio/catalog-actions.ts` is the canonical server-action facade. It validates active-artist scope before delegating to `catalog-actions-internal.ts`.

Do not import `catalog-actions-internal.ts` from UI routes or components. It exists only to preserve the lower-level mutations behind the artist-safe facade.

This replaces the previous TypeScript path-alias redirection. Safety now comes from the module boundary itself rather than resolver configuration.

## Test layers

`npm run test:studio` discovers every `tests/*.test.mjs` file automatically, so new contracts cannot be silently omitted from CI.

Browser-level smoke coverage lives in `e2e/` and runs with Playwright Chromium in CI. Playwright is installed ephemerally and pinned in the CI workflow so browser tooling stays outside the production dependency graph.

To run the browser suite locally without modifying the lockfile:

```bash
npm install --no-save --package-lock=false @playwright/test@1.63.0
npx playwright install chromium
npm run test:e2e
```

The browser suite intentionally starts small and high-value. It validates public-vs-private surface contracts and API traceability without requiring production credentials or sending external side effects.

## TypeScript baseline

Application TypeScript targets ES2022 with strict mode enabled and JavaScript source checking disabled. Node.js 22 and the current browser baseline do not require the previous ES2017 output target.
