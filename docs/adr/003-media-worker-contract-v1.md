# ADR 003: Versioned Media Worker contract

**Status:** Accepted  
**Date:** 2026-09-09

## Context

The Media Worker crosses a real runtime boundary: TypeScript creates and dispatches durable jobs while Python validates and executes them. Job discriminators had grown in multiple places, while payload/result values remained largely untyped records. A mismatch could survive TypeScript compilation and fail only after Sandbox dispatch.

## Decision

The worker envelope is versioned explicitly.

Canonical references:

- `contracts/media-worker.v1.json` documents the protocol and complete discriminator set.
- `lib/media-worker/contract.ts` is the TypeScript contract surface.
- `lib/media-worker/dispatcher.ts` adds the contract version marker to every dispatched payload.
- `services/media-worker/app/runner.py` validates the version and supported discriminator before selecting an executor.

Version key: `__ensemblis_media_worker_contract_version`.

The v1 envelope standardizes discriminator/version/callback status. Job-specific payloads and results remain owned by their domains instead of creating one giant union immediately.

A regression test verifies discriminator and version parity across JSON, TypeScript, Sandbox dispatch and Python.

## Consequences

- Unknown protocol versions fail before expensive worker execution.
- Adding a job type requires updating the canonical contract and both runtime surfaces deliberately.
- We can introduce job-specific schemas incrementally without blocking current workloads.
- A future incompatible envelope change requires `media-worker.v2` rather than silently changing v1 semantics.
