# Ensemblis UX Polish

Status: Active implementation plan

## Purpose

Ensemblis has reached a stage where product capability is no longer the main UX constraint. The product understands music, releases, campaigns, media, audiences, distribution, analytics, automation and AI workflows, but the interface can expose too much of that complexity at once.

This initiative turns Ensemblis into a calm, coherent operating system for artists. It does not remove capability. It changes when and how capability is revealed.

## Experience north star

A user should be able to open Ensemblis and answer three questions immediately:

1. What matters now?
2. What is Ensemblis already doing for me?
3. What decision, if any, needs me?

The intended product feeling is calm, intelligent, musical, premium and trustworthy.

## Product principles

### 1. Outcome before subsystem

Navigation and page structure should describe what an artist wants to accomplish, not the internal implementation that powers it.

### 2. One primary action per screen

Each screen should have one visually dominant action. Secondary actions belong in contextual menus, inspectors, text actions or advanced controls.

### 3. Progressive disclosure

Advanced model settings, raw analysis values, provider details, technical diagnostics and uncommon controls stay hidden by default. They remain available when explicitly requested.

### 4. Autonomy must be visible

Long-running or autonomous work must never feel like a frozen request. Ensemblis should show what it is doing, its current state and whether the user can safely leave the page.

### 5. Human judgment is a first-class workflow

Approvals, ambiguity, external effects and explicit spending are surfaced clearly. Internal work should proceed without unnecessary interruption.

### 6. Product chrome is Ensemblis, creative output is the artist

The application shell remains visually neutral and recognizably Ensemblis. Artist branding belongs in artwork, previews, generated media and artist-specific data, not in the application chrome.

### 7. Prefer hierarchy over containers

Do not solve every grouping problem with another card. Lists, dividers, whitespace and typography should carry most of the hierarchy. Cards are reserved for meaningful objects or strong conceptual groups.

## Information architecture

### Work

- Today
- Music
- Releases
- Create
- Grow
- Audience
- Library

### Manage

- Sites
- Distribution
- Connections

### Account

- Settings

Existing routes remain stable during the UX migration. The first pass changes labels and grouping, not route contracts.

### Workspace ownership

#### Music

- Track Vault
- Track intelligence
- Stems
- Lyrics
- Audio scenes

#### Releases

- Upcoming
- Released
- Drafts
- Distribution entry points where release context is primary

#### Create

- Content
- Social posts
- Artwork
- Video
- Creative projects

#### Grow

- Overview
- Campaigns
- Calendar
- Opportunities
- Performance
- Learnings

## Global shell

The protected application shell consists of three stable layers:

```text
Sidebar | Context bar
        | Main workspace
```

### Sidebar

The sidebar is for durable destinations only. It is grouped into Work and Manage sections, with Settings separated from the primary workflow.

### Context bar

The top context bar communicates the active artist and provides high-frequency global actions such as Needs you and Create. Future iterations may add command search and object context when those features are implemented, but the shell must not advertise non-functional controls.

### Command palette

Target interaction: `Cmd/Ctrl + K`.

Planned capabilities:

- search tracks, releases, campaigns and assets
- navigate to product areas
- invoke common actions such as import track, create release and create content
- surface recent objects

The command palette is intentionally not part of the first implementation patch. It should be added only with complete search/action behavior.

## Today v3

Today is not an analytics dashboard. It is the decision surface for the current day.

It contains exactly four primary concepts:

### 1. Next best action

The strongest ranked intervention that requires or benefits from human action. It includes the rationale and one primary action.

If no intervention is needed, Ensemblis explicitly says that it can keep moving without interruption.

### 2. Needs you

Only items requiring judgment, approval, ambiguity resolution, missing creative input or review.

Examples:

- publication approval
- outreach approval
- manual publishing handoff
- catalog reconciliation
- missing scheduled asset
- due task
- evidence-backed learning awaiting approval

### 3. Working

Only currently active or queued autonomous work. Backend state names are translated into human product language.

### 4. Coming up

Scheduled publication or content events in the near-term planning window.

Everything else belongs in its owning workspace.

## Human-facing state language

Backend state must not leak into the product UI.

| Internal state | Product language |
| --- | --- |
| `awaiting_approval` | Needs approval |
| `provider_scheduled` | Scheduled |
| `manual_ready` | Ready for handoff |
| `queued` | Queued |
| `running` | Working |
| `publishing` | Publishing |
| `reconcile_pending` | Needs matching |
| `failed` | Failed |

Use semantic language even when the underlying backend state changes.

## Page hierarchy

Every product page should use the same hierarchy:

1. Page or object identity
2. Primary action
3. Current decision or current state
4. Core content
5. Secondary information
6. Advanced or technical information

## Object headers

Tracks, releases, campaigns, content items and assets should converge on a shared object-header pattern.

Example:

```text
Back to Music

[cover] Night Drive
        Atlas Irwin
        03:42 · 124 BPM · Analyzed

Overview  Intelligence  Lyrics  Stems  Content
```

The implementation should eventually provide a reusable `ObjectHeader` primitive rather than independently composing every object screen.

## Progressive disclosure patterns

### Default view

Show interpretation and actionability:

- BPM, key and high-level energy
- strongest hook
- track structure
- recommended next action

### Advanced view

Reveal on demand:

- analysis model and version
- confidence components
- raw sections and beat data
- provider routing
- model overrides
- technical diagnostics

## Contextual inspector

Settings related to the selected object should prefer a right-side inspector on desktop and a full-height sheet on narrow screens.

Good inspector candidates:

- content settings
- generation settings
- release metadata
- asset metadata
- scheduling
- advanced AI controls

A settings form should not take over a full page when the user needs to keep visual context of the object being edited.

## Shared UI foundation

Ensemblis should converge on a deliberately small internal component vocabulary:

- Button
- IconButton
- Badge / Status
- Card / Surface
- PageHeader
- ObjectHeader
- SectionHeader
- Tabs
- EmptyState
- Callout
- ListRow
- Metric
- Menu
- Tooltip
- Dialog
- Sheet
- Select
- Progress
- Skeleton

The first implementation pass should reuse the current stack and avoid coupling the information-architecture migration to a new component dependency. Radix primitives can be introduced incrementally in a dedicated follow-up.

## Visual hierarchy

### Typography

Use a predictable hierarchy:

- Display: rare hero or creative surfaces
- H1: one page title
- H2: primary section
- H3: object title
- Body: primary content
- Small: metadata
- Micro: labels and statuses only

Avoid excessive uppercase, tiny explanatory copy and multiple competing font weights inside one component.

### Color

- Neutral: normal product chrome
- Ensemblis accent: selection and primary interaction
- Green: success and healthy state only
- Amber: attention required
- Red: error or destructive action
- Violet/blue: AI or autonomous processing where useful

Color is supplementary. Meaning must remain clear from text and structure.

### Surfaces

Avoid card soup. Prefer rows and sections for queues, status lists and lightweight information. Use cards for meaningful objects, previews and high-value decision surfaces.

## Empty states

An empty state should teach the workflow and offer the appropriate first action.

Bad:

`No releases found.`

Preferred:

`Your releases will live here. Add an upcoming or existing release and Ensemblis will connect its music, campaign, content and performance.`

Empty-state language may change after the first object exists.

## Loading and autonomous work

Avoid blocking spinners for long operations.

Prefer staged progress language:

```text
Analyzing track
✓ Reading audio
✓ Mapping structure
● Finding hooks
○ Building creative moments
```

When work is durable, tell the user they can leave the page and surface the job in a global activity view.

## Approval UX

Approval is a core Ensemblis workflow, not a generic database queue.

An approval surface should prioritize:

1. preview of the external effect or creative
2. concise context
3. why Ensemblis chose it
4. primary Approve action
5. Edit as secondary action
6. Reject or destructive alternatives with lower visual priority

## Create UX

Creative output should visually dominate the workspace. Configuration supports the preview rather than becoming the main content.

Default generation should require as few controls as possible. Model, seed, prompt, exact hook, stem mix and other expert controls belong under Advanced unless they materially affect the current decision.

## Responsive behavior

Desktop remains the primary production workspace, but narrow layouts must be intentional.

Target behavior:

- full sidebar collapses to compact navigation
- contextual inspectors become full-height sheets
- tables become list rows where practical
- hover-only actions gain explicit controls
- creative previews remain readable and central

A future mobile navigation iteration may introduce a bottom navigation pattern once the primary IA stabilizes.

## Motion

Use the existing Framer Motion dependency where motion materially improves state comprehension.

Guidelines:

- controls: roughly 120 to 180 ms
- sheets and inspectors: roughly 180 to 240 ms
- subtle expansion and insertion transitions
- clear progress-state transitions
- no decorative AI glow or constant floating animation
- always respect `prefers-reduced-motion`

## Accessibility

Every polished surface must include:

- keyboard navigation
- visible focus state
- semantic heading order
- accessible names for icon-only controls
- sufficient contrast
- touch targets suitable for narrow screens
- state meaning that does not depend on color alone
- reduced-motion behavior

## Definition of done for a polished screen

A screen is not considered polished until all answers below are yes:

- Is the current location obvious within one second?
- Is one next action visually dominant?
- Is the most important information easy to scan?
- Is autonomous work visible without becoming distracting?
- Is required human intervention impossible to miss?
- Are advanced controls hidden by default?
- Are external/public effects explicit?
- Is spending explicit before it occurs?
- Is uncertainty or weak evidence represented when meaningful?
- Are technical backend states translated into product language?
- Is the empty state useful?
- Are loading, success and error states designed?
- Does the screen work with keyboard navigation?
- Does the screen behave intentionally on a narrow viewport?
- Does it look like Ensemblis rather than an artist-specific dashboard?

## Rollout plan

### Phase 1: Foundation

- design tokens and spacing
- typography hierarchy
- buttons and status language
- shared surfaces
- PageHeader and future ObjectHeader rules
- empty/loading/error conventions

### Phase 2: Global shell

- grouped sidebar IA
- persistent context bar
- global Needs you and Create entry points
- responsive shell
- later: command palette and global activity drawer

### Phase 3: Today v3

Reduce Today to:

1. Next best action
2. Needs you
3. Working
4. Coming up

Remove dashboard-only evidence and metrics from Today and keep them in their owning workspaces.

### Phase 4: Core workflows

Polish in this order:

1. Music
2. Release
3. Create
4. Grow
5. Audience
6. Library

For every workflow: remove noise, consolidate concepts, prioritize the next action, then refine presentation.

### Phase 5: Object UX

- Track ObjectHeader
- Release ObjectHeader
- Campaign ObjectHeader
- Content ObjectHeader
- asset inspector

### Phase 6: Interaction polish

- optimistic feedback
- undo where appropriate
- confirmations
- skeletons
- keyboard navigation
- command palette
- responsive behavior
- accessibility audit

### Phase 7: Creative UX

Integrate richer creative interaction deliberately:

- WaveSurfer timeline
- resumable Uppy/TUS upload flows
- drag/drop where it materially improves ordering or composition
- richer media timeline/editor experiences

## First implementation milestone

This document accompanies the first production slice:

- reorganize sidebar into Work and Manage groups
- rename the Growth navigation label to Grow
- add a persistent artist context bar with Needs you and Create actions
- simplify Today to the four decision surfaces
- reduce Today server work by removing data fetches used only for dashboard evidence
- add focused UX polish styles without changing route contracts or backend schemas

## Non-goals for the first milestone

- no route migration
- no data-model migration
- no new UI dependency
- no command palette placeholder without working behavior
- no rewrite of existing feature screens
- no removal of advanced capabilities
- no redesign of the public artist website

## Migration strategy

Prefer reversible, incremental changes. Shared routes and backend behavior stay intact while presentation converges. New primitives should wrap stable behavior rather than force simultaneous rewrites of every feature.

Every follow-up UX PR should reference this document and identify which phase and Definition of Done items it advances.
