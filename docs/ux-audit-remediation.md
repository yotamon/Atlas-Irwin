# Ensemblis UI/UX audit remediation

This branch remediates the complete 80-item Studio + public-site UX audit. The checklist is grouped by root cause so fixes remain systemic rather than one-off patches.

## Foundation and information architecture
- [x] Shared readable typography/control scale
- [x] Canonical interaction primitives for dialogs, confirmation, status, field help/error, progress and skeleton states
- [x] Desktop/mobile primary navigation uses the same outcome model
- [x] Create is a global action instead of duplicate destination/navigation
- [x] Specialist routes retain a visible parent context
- [x] Needs You has one global placement rather than duplicated sidebar chrome
- [x] Artist switching discards stale object IDs and workflow query state
- [x] Deep release links preserve explicit artist context
- [x] Non-critical onboarding activation lookup cannot crash the Studio shell
- [ ] Retire the generated legacy compatibility bridge without regressing specialist routes

## Interaction, accessibility and states
- [x] Mobile More uses a modal dialog with backdrop, focus trap, Escape and focus return
- [x] Browser confirm dialogs replaced with product confirmation dialogs
- [x] Native title tooltips removed from shared controls
- [x] Page transition reduced to a fast non-blur transition with reduced-motion support
- [x] Global loader no longer claims fake work stages
- [x] Processing steps expose state without making the whole surface a noisy live region
- [x] Tabs expose horizontal overflow
- [x] Command palette shows platform-neutral shortcut and distinct retryable search errors
- [x] Artist selector is static when only one artist is available
- [x] Not-found route preserves artist context when present
- [x] User-facing error boundaries do not expose backend/worker messages
- [x] First-use guidance can be dismissed in place

## Mobile and upload UX
- [x] Primary/mobile labels use readable text scale and touch-safe targets
- [x] Mobile More is a focused utility sheet instead of a miniature competing sidebar
- [x] Invalid upload selections explain the rejection
- [x] Dropzone itself is keyboard/click operable
- [x] 100 MB limit is visible before upload
- [x] Upload batches use bounded concurrency
- [x] Small uploads show indeterminate progress
- [x] Upload announcements are scoped rather than live-updating the whole queue
- [x] Upload errors are translated to product-safe messages
- [x] Drag leave no longer flickers on child traversal
- [x] Upload completion avoids unnecessary route refresh when context does not require it

## Active Mastering
- [x] Full verification evidence is presented as a human-readable report
- [x] Raw JSON is no longer the primary analysis UI
- [x] A/B uses one synchronized shared transport
- [x] A/B supports loudness-matched comparison
- [x] Master creation uses pending submit state
- [x] Canonical promotion uses explicit confirmation + pending state
- [x] Job state polling is scoped to mastering jobs instead of route refresh
- [x] Failed worker messages are translated before display

## AutoMix
- [x] Track selection starts empty and remains explicitly artist-chosen
- [x] 20-track limit gives immediate feedback
- [x] Running order supports drag/drop plus keyboard/button fallback
- [x] Setup is explicit that pre-render order is a seed, not a verified plan
- [x] Actual worker-generated DJ plan streams into the running session after analysis
- [x] Active sessions can be safely cancelled
- [x] Final ceiling is shown only from measured render data
- [x] Output action is a real download action
- [x] API/worker errors are translated before display

## Today
- [x] Above-the-fold UI contains one primary move
- [x] Hero decision is not duplicated inside Needs You
- [x] Background work, additional decisions and coming-up items are progressively disclosed

## Release workspace
- [x] Release links preserve artist context
- [x] Six top-level tabs reduced to four; Content/Promotion/Distribution are nested under Release work
- [x] Specialist/legacy workspace is progressively disclosed rather than competing with the normal workflow
- [x] Overview keeps release details and exceptional controls collapsed by default

## Public artist site
- [x] Browser scrollbar remains visible
- [x] Mobile hero typography/height is bounded
- [x] Global overflow masking removed
- [x] Release widget participates in normal document flow instead of paired negative offsets
- [x] Selected older catalog releases are not announced as “New Release”
- [x] Only the featured canvas may autoplay; shelf previews run on hover/focus
- [x] Reduced-motion keeps a paused visual instead of an empty canvas stage
- [x] Public-player touch targets are at least 44 px on mobile
- [x] Excessive uppercase tracking is reduced for player readability

## Final gate
- [ ] TypeScript
- [ ] ESLint
- [ ] Studio tests
- [ ] Production build
- [ ] PR diff review against all 80 findings
