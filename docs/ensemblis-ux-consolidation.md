# Ensemblis UX Consolidation

## Goal

Turn the current Ensemblis Studio into one calm, music-native product experience without exposing legacy/internal machinery in the default workflow.

This work intentionally ships as one product PR so CI and preview deployment run once after the complete UX pass is assembled.

## Product principles

1. **One obvious next action.** Today and object workspaces should rank work instead of presenting competing CTAs.
2. **Music before machinery.** Tracks, Moments, lyrics, stems, artwork and outcomes are primary. Providers, campaign engines and maintenance tools are secondary.
3. **One mental model per job.** A user should never encounter two different destinations with the same product name or purpose.
4. **Progressive disclosure.** Trust, provenance and advanced controls remain inspectable without dominating the default surface.
5. **Automatic by default.** Refresh, sync and diagnostic controls should not look like routine user chores.
6. **Mobile is a first-class product surface.** Primary work remains reachable with one thumb; desktop sidebars do not collapse into unusable icon rails.
7. **Artist identity belongs to the artist.** Ensemblis chrome stays neutral and music-native rather than imposing an AI visual style on generated creative.

## Scope

### P0 · Correctness and navigation

- Replace the narrow-screen sidebar with persistent bottom navigation and a More sheet.
- Keep all five primary areas reachable: Today, Music, Releases, Create and Grow.
- Keep Audience, Library, Memory, Sites, Distribution, Connections and Settings reachable on mobile.
- Make `/studio/needs-you` the canonical decision queue everywhere.
- Reframe `/studio/inbox` as the specialist **Approvals** surface reached from Needs You.
- Fix first-use onboarding so Moment review links directly to the create/Moments stage.

### P1 · Product simplification

- Merge competing Today hero actions into one ranked next-move surface.
- Remove connection-management duplication from Settings; Connections owns integrations.
- Move manual growth/audience refresh controls out of page-header primary actions.
- Remove legacy/specialist tools from the default Create experience.
- Shorten explanatory product-philosophy copy across primary surfaces.
- Introduce one Ensemblis audio preview interaction for repeated track/Moment playback.

### P2 · Trust, scale and visual hierarchy

- Move detailed Artist Memory confidence/provenance/consumer metadata behind progressive disclosure.
- Add basic Library search/type filtering so the visual grid remains usable as the asset count grows.
- Reduce decorative/elevated treatment on common product surfaces and reserve emphasis for real state and media.
- Keep advanced and maintenance controls available without allowing them to define the product.

## Acceptance criteria

- No primary mobile destination becomes unreachable below 900 px.
- `Needs You` always resolves to the universal decision queue; approvals are clearly named `Approvals`.
- The first-use `Review Moments` CTA lands on the actual Moment review UI.
- Settings does not duplicate Spotify/SoundCloud/social connection cards.
- Today presents one ranked next move before secondary operational sections.
- Create defaults to a small set of music-backed directions and does not advertise legacy tools.
- Manual refresh/sync actions are available only as advanced/data controls.
- Repeated track and Moment previews use a consistent Ensemblis player.
- Artist Memory shows understandable beliefs first and technical evidence on demand.
- Library can be searched and filtered by media type.
- Keyboard focus, touch targets, reduced-motion behavior and existing approval/distribution safety semantics are preserved.

## Verification

Run only after the complete branch is created:

- `npm run test:studio`
- `npm run typecheck`
- `npm run lint`
- PR preview smoke test at desktop and narrow widths
- Verify Today → Needs You → Approvals
- Verify onboarding → Music → Mission → Moment
- Verify mobile primary navigation and More sheet
- Verify Music/Create audio previews
