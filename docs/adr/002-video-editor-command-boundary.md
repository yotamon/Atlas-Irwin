# ADR 002: Video Editor command boundary

**Status:** Accepted  
**Date:** 2026-09-09

## Context

Video Editor server actions repeated authentication, active-artist resolution, service-client creation, project lookup and archived-project guards. High-value domain rules such as generation invalidation, character continuity, lip-sync audio requirements, timeline trimming and human QC were embedded inside Next.js actions.

## Decision

Video Editor commands use two explicit layers:

1. `lib/video-director/editor-session.ts` owns the authorized command session, project/artist invariant and project-source asset scope.
2. `lib/video-director/editor-policy.ts` owns mutation policy that does not depend on Next.js request mechanics.

Server actions validate external input with Zod, acquire the session, invoke policy, persist the mutation and revalidate the relevant route.

This is not a repository-pattern mandate. Supabase remains the real persistence implementation. We extract only seams that own meaningful authorization or domain policy.

## Consequences

- Authorization/scoping behavior cannot drift independently between timing, quality, source and shot-edit commands.
- Pure mutation policies can be reviewed and tested independently from React/Next.js plumbing.
- Server action files remain the public application boundary but no longer own generation/QC semantics.
- New editor commands should extend the shared session/policy rather than rebuilding authorization from scratch.
