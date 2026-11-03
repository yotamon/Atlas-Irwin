# Atlas Irwin Release Runway — Ensemblis implementation program

**Started:** 2026-11-03  
**Scope:** repeatable, evidence-backed music releases using Ensemblis; Atlas Irwin is the reference artist, not a hard-coded product assumption.  
**Status:** In progress. Do not treat a merged UI feature as proof of live provider readiness.

## Product acceptance

An artist can choose a mastered recording, verify the exact approved waveform, establish copyright and contributor declarations, prepare and explicitly approve distributor delivery (or safely document an external handoff), create static and looping social assets, schedule and approve public posts, share a stable listening destination, and inspect real first-party events and provider outcomes. Every non-reversible external effect remains approval-gated.

## Evidence from read-only production review (2026-11-03)

- Music ingestion is multi-file and resumable, but the reference artist's live Vault catalog is smaller than the private source library. Reconcile identity/versions before inferring that every recording has been imported.
- Five existing catalog releases are marked Live, but no provider distribution account, release configurations, submissions or deliveries are recorded. Existing public release status is **not** evidence of DSP submission.
- A connected Instagram profile exists, but its last verified connection predates this review. Never infer current publication authorization without a refresh and a harmless approved test.
- First-party Smart Links exist, but no measured link events were recorded in the read-only audit. A 0 can reflect no traffic or incomplete instrumentation; show evidence rather than fabricated conversions.
- Two mastering jobs failed historically; safe retry and source preservation are mandatory for the first live release.
- Production schema migration history is behind the repository, including the Living Artwork media-job constraint and Release Visual derivatives strategy. Treat these as operational preconditions for reliable social creative, not a cosmetic warning.

## P0 — establish a trustworthy launch

1. **Reconcile schema and runtime.** Compare all migration version/name pairs, review outstanding SQL for dependency and rollback risk, execute through protected production delivery only after explicit infrastructure approval, and verify objects + permissions + Worker behavior. No history-only repair that hides missing objects.
2. **Reconcile the reference artist's audio catalog.** Import all intended masters with no duplicate identities; preserve original filenames, hashes, source/derived variants and artist scoping. Never guess which version is legally or sonically final.
3. **Master readiness per waveform.** Measure and audition, approve the exact byte lineage; never silently promote a mastering candidate or rewrite another track in a multi-track release.
4. **Distribution last mile.** Connect and verify a real provider account or use an explicit externally verified handoff. Validate complete canonical identity, masters, credits, rights/AI disclosures, dates, store destinations and submission receipts.
5. **Truthful readiness.** Today and Release must use the same distribution evidence, distinguish site Live from provider Live, and show unavailable/unknown as unverified. Do not imply that attached audio is technically approved.

## P1 — repeatable release promotion

6. **Creative kit.** One release action produces approved Story, feed and square visuals from a single artwork spec, optional loop/Canvas/short cut, and accessible exports. Validate actual media bytes, aspect ratios, loop seams and worker callbacks.
7. **Campaign execution.** Pre-release → launch → follow-up phases, artist-approved copy, recovered schedules, limited retries, no publication or spend without the appropriate approval.
8. **Owned path + attribution.** Stable artist-owned Smart Link, tested landing/outbound event capture, content variant → destination lineage, and clear separation of a click from a stream/save.
9. **Cross-release calendar.** Show upcoming releases and provider/social/creative deadlines, detect scheduling conflicts, preserve ability to re-plan before irreversible publication.
10. **Learning.** Only recommend winning assets after sufficient verified listening, retention or first-party conversion evidence. Unknown evidence stays unknown.

## P2 — excellence, after the first complete launch

- Active Mastering V2 perceptual validation, album coherence and blind comparisons; never ship unverified DSP changes over the safe baseline.
- Rich provenance exports and provider-specific compliance checks for AI-assisted and virtual projects; artist rights cannot be inferred automatically.
- Outreach, consent-first fan relationships and paid experiments, progressively unlocked only when their evidence and permissions are real.

## Reference E2E proof (non-destructive first)

- Import a permitted test master and verify per-artist media isolation, duration, hash and duplicate/version handling.
- Verify Master Readiness; prove an unverified master cannot pass Distribution.
- Prepare release metadata with explicit legal rights and profile decisions.
- Generate approved art; test one full-size image and an approved looping export (in a controlled environment).
- Test a stable link and first-party landing/action; ensure reporting does not label it a confirmed stream.
- Test a publication in an authorized test account, retaining its real external post ID and safe retry state.
- Submit a real distributor release only with artist approval, valid contracts, approved date, and a reviewed external-impact checklist.
- Verify a store response and public release link; exercise failed/ambiguous provider state without duplicate submission.

## Execution order and safety

- Small scoped PRs, targeted contract tests first; broaden to typecheck/lint/build and browser tests at integration boundaries.
- Keep the artist/workspace security model and approved media lineage. Do not make Atlas-specific catalog assumptions in generic code.
- Avoid a long-lived one-size-fits-all implementation branch.
- Pending user-only checks: review masters by ear, confirm the distributor account/terms, approve exact contributor and rights declarations, approve actual public posts, and authorize final DSP submission.
