# Ensemblis UX V4 Route Inventory

**Status:** Canonical migration inventory
**Reconciled:** 2026-09-23
**Source:** current protected Studio routes on main + UX V4 implementation branch

## Contract

Route existence does not imply navigation priority.

Every protected route must have:
- one visible V4 owner;
- one natural discovery path;
- a reason to remain a full page rather than a widget, inspector or workflow stage.

Primary workspaces remain **Today / Music / Grow**. Create is a global action. Library, Sites and Settings are utilities. Everything else is contextual or specialist.

| Route | V4 owner | Role | Natural discovery | V4 target |
| --- | --- | --- | --- | --- |
| /studio | Today | Primary workspace | Primary nav | Start / continue / decide |
| /studio/needs-you | Today | Decision queue | Today + global action | Contextual decisions |
| /studio/inbox | Today | Specialist approvals | Needs You | Advanced approval history |
| /studio/autopilot | Today | Compatibility projection | Today / Settings | Quiet autonomous status |
| /studio/tasks | Today | Specialist operations | Today | Do not promote as primary work |
| /studio/music | Music | Primary workspace | Primary nav | Tracks / Releases / Mixes |
| /studio/music/[id] | Music | Track object | Music + search | Canonical Track workspace |
| /studio/music/import | Music | Intake workflow | Add music | Contextual workflow |
| /studio/music/automix | Music | Mix workflow | Launcher / Track / Music Mixes | Music → Intent → Build → Review → Render |
| /studio/releases | Music | Release collection | Music → Releases | Object collection |
| /studio/releases/new | Music | Release creation | Prepare a release | Bounded creation workflow |
| /studio/releases/[id] | Music | Release object / Mission | Music + search + Continue | Canonical Release workspace |
| /studio/releases/[id]/distribution | Release | Specialist delivery | Release → Distribution | Deep provider/delivery surface |
| /studio/distribution | Release | Compatibility / specialist | Release → Distribution | Keep out of primary navigation |
| /studio/distribution/operations | Release | Operations specialist | Distribution advanced | Provider operations only |
| /studio/create | Global Create | Action launcher | Create + object actions | General outcome launcher |
| /studio/content | Create | Compatibility surface | Create advanced | Fold normal work into Creative Assets |
| /studio/production | Create | Creative work queue | Object Create / Continue | Creative Asset work |
| /studio/video | Create | Video workflow | Create / Release | Guided Video Director |
| /studio/video/[id] | Create | Video project object | Video / Continue | Creative Asset object |
| /studio/growth | Grow | Primary workspace | Primary nav | Recommended action / opportunities / audience / performance |
| /studio/growth/strategy | Grow | Strategy specialist | Grow → Why | Inspector / advanced strategy |
| /studio/growth/paid | Grow | Paid growth specialist | Opportunity / approval | Approval-gated workflow |
| /studio/growth/import | Grow | Compatibility redirect | Contextual | Retire when callers migrate |
| /studio/analytics | Grow | Performance specialist | Grow → Performance | Deep analytics only |
| /studio/audience | Grow | Audience lens | Grow → Audience | Contextual growth view |
| /studio/audience/fans/[id] | Grow | Fan object | Audience | Deep audience object |
| /studio/campaigns | Grow / Release | Specialist campaign collection | Opportunity / Release Promotion | Advanced machinery |
| /studio/campaigns/[id] | Grow / Release | Campaign object | Release / Grow | Deep specialist object |
| /studio/campaigns/[id]/intelligence | Grow / Release | Technical campaign intelligence | Campaign advanced | Inspector / technical view |
| /studio/calendar | Grow | Planning specialist | Grow | Contextual planning |
| /studio/outreach | Grow | Outreach specialist | Opportunity | Contextual approval workflow |
| /studio/outreach/[id] | Grow | Outreach object | Outreach / Needs You | Deep specialist object |
| /studio/learn | Grow | Learning evidence | Results / Memory | Advanced evidence |
| /studio/library | More | Utility workspace | More / search | Cross-workflow media library |
| /studio/media | Library | Compatibility media surface | Library | Consolidate into Library |
| /studio/sites | More | Utility workspace | More / search | Owned destinations |
| /studio/sites/smart-links | Sites | Smart-link specialist | Sites / Release | Contextual destination tool |
| /studio/settings | Settings | Configuration home | More | Configuration only |
| /studio/settings/artist | Settings | Artist profile | Settings / contextual Why | Inspector-capable settings |
| /studio/settings/ai | Settings | AI policy | Settings | Advanced policy |
| /studio/settings/autonomy | Settings | Autonomy policy | Settings / approval explanation | Advanced policy |
| /studio/settings/brand | Settings | Brand context | Settings | Configuration |
| /studio/settings/brand/visual | Settings | Visual brand specialist | Brand settings | Advanced configuration |
| /studio/settings/social/[platform] | Settings | Platform settings | Connections / Settings | Connection configuration |
| /studio/connections | Settings | Integration utility | Launcher / Settings | Connection hub |
| /studio/brand | Settings | Compatibility brand route | Settings | Migrate callers |
| /studio/memory | Settings | Artist Memory | Settings / Why this? | Inspectable context |
| /studio/data-health | Settings / Recovery | Technical recovery | Contextual blocker | Do not use as daily destination |
| /studio/spotify | Settings | Provider specialist | Connections | Provider detail |
| /studio/soundcloud | Settings | Provider specialist | Connections | Provider detail |

## Migration priority

### V4 default surfaces
These define the normal mental model and receive product-design investment first:
Today, Music, Track, Release, Mix, Create, Grow.

### Contextual specialist surfaces
These remain full pages only while the task genuinely benefits from sustained specialist space:
Video Director, Distribution delivery, Campaign detail, Paid Growth, Audience fan detail.

### Compatibility / retirement candidates
These must not gain new navigation or new product concepts:
Inbox, Autopilot, Tasks, Content, Media, Growth Import, Brand compatibility routes and standalone provider pages.

## Acceptance rule

A route may remain indefinitely if deep-linking or specialist work benefits from it. It fails V4 only when the user must already know that route exists in order to accomplish a normal artist goal.
