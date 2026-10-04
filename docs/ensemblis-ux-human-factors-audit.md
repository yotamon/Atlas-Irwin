# Ensemblis UX Human-Factors Audit

**Status:** Baseline captured from the current V5 implementation; authenticated screenshot execution is wired into Playwright and remains environment-gated by legitimate Studio credentials.
**Date:** 2026-10-04
**Branch:** `design/ensemblis-ux-human-factors`

## Method

The baseline combines:

1. repository-level inspection of the current Studio composition;
2. the ten canonical V5 acceptance journeys;
3. named screenshot checkpoints added to the authenticated Playwright suite;
4. the human-factors scorecard from the recovery design.

The generic GitHub browser smoke intentionally does not authenticate into Studio. The screenshot checkpoints therefore become real audit evidence only when `npm run test:e2e:studio` runs with legitimate `STUDIO_E2E_EMAIL` / `STUDIO_E2E_PASSWORD` or the existing safe localhost authenticated path. No test-only auth bypass is permitted.

## Structural baseline

| Journey | Baseline finding | Priority |
| --- | --- | --- |
| Understand a track | Track remains a long orchestration surface with state, actions, analysis, mastering, stems, lyrics and technical evidence competing within one object page. | P0 |
| Master a track | Safety and fidelity logic are strong, but the artist-facing experience still exposes multiple mastering concepts instead of one stage at a time. | P0 |
| Grow | Default Grow still renders many peer sections/actions, forcing the artist to interpret a capability dashboard after seeing the recommendation. | P0 |
| Prepare a release | Release has the correct lifecycle model but still exposes many modules within the same workspace. | P0 |
| AutoMix | The workflow has canonical stages, but specialist DJ machinery and builder complexity can still compete with the active stage. | P1 |
| Music / Add music | Object-first library is improved; intake still spends too much copy explaining product philosophy instead of consequences. | P1 |
| Today | Today is calmer than downstream pages, but Continue and Priority can compete as two large visual blocks. | P1 |
| Create | Outcome-first model is strong; alternatives can still look too equal to the recommended option. | P1 |
| Needs You / failure recovery | Core semantics are good; verify mobile and recovery screenshots after the main journey compression. | P2 |
| Advanced detail | Existing inspectors/disclosures are the right mechanism; the recovery should consolidate more detail into them rather than invent another pattern. | P1 |

## Screenshot checkpoints

The authenticated suite now attaches full-page screenshots for:

- `ux-01-add-music`
- `ux-02-track`
- `ux-02-mastering`
- `ux-03-create`
- `ux-04-release`
- `ux-05-automix`
- `ux-06-grow`
- `ux-08-needs-you`
- `ux-mobile-music`

Additional final-state screenshots will be added if a migrated journey introduces a distinct decision stage that is not represented above.

## Baseline hard-gate assessment

| Hard gate | Baseline |
| --- | --- |
| Relevant object obvious | Mostly pass |
| Current state obvious | Mixed on Track/Release |
| Exactly one dominant next action | Fail on dense downstream surfaces |
| Default screen within complexity budget | Fail on Track/Grow/Release |
| Consequential actions explicitly gated | Pass; must not regress |

## Implementation order confirmed

The baseline confirms the recovery order:

1. Track + shared action hierarchy
2. Mastering
3. Grow
4. Release
5. AutoMix
6. Music / Today / Create
7. Mobile/accessibility
8. friction telemetry and final authenticated re-audit

## Environment boundary

Authenticated screenshots are deliberately not fabricated from public pages or mocked login state. If the dedicated Studio acceptance workflow cannot run because credentials are unavailable to the execution environment, that limitation remains explicitly recorded until a legitimate authenticated run is possible.
