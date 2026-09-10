# Ensemblis UX Architecture V3

Status: canonical artist-facing product architecture

## Product principle

Ensemblis should become more capable while the artist-facing interface becomes simpler.

The product is not a catalog of internal engines. It is a music-aware artist manager that understands the work, chooses the next useful move, performs safe work autonomously and interrupts the artist only when judgment is genuinely required.

The interface therefore optimizes for artist outcomes, not implementation domains.

## Primary product model

The durable primary navigation is intentionally limited to five destinations:

1. **Today** — what matters now.
2. **Music** — the artist's source material and musical understanding.
3. **Releases** — release Missions that coordinate everything around a release.
4. **Create** — finished creative deliverables grounded in the music.
5. **Grow** — audience, opportunities, performance and career growth.

Do not add a new primary destination merely because Ensemblis gains a new engine, database domain or provider integration.

## Contextual ownership

Internal capabilities belong to the artist outcome that gives them meaning.

| Capability | Artist-facing owner | Rule |
| --- | --- | --- |
| Audience / fan intelligence | Grow | Audience is a growth lens, not a separate product. |
| Analytics / metrics | Grow or Release Results | Show interpretation where the decision is made. |
| Campaign engine | Release Promotion or Grow | Campaign configuration is advanced machinery beneath a goal. |
| Distribution | Release | Distribution exists to move a specific release into the world. |
| Artist Memory | Settings / Artist profile | Memory is context Ensemblis uses, not daily work. |
| Connections | Settings | Integrations are configuration, not an artist outcome. |
| Data health | Contextual recovery | Surface the repair where it blocks work; do not make health a normal destination. |
| Paid growth | Grow | Paid execution is an advanced growth strategy and remains approval-gated. |
| Sites / Library | More | Cross-workflow utilities may live in More when no single outcome owns them. |

Specialist routes may continue to exist for deep links, debugging, migration and advanced workflows. Their existence does not grant them navigation priority.

## Today: the Manager loop

Today is not a dashboard. It is the thinnest useful projection of the artist operating system.

The default hierarchy is:

1. **One next move** — the highest-impact decision or Mission action.
2. **Needs You** — only approvals, ambiguity and decisions requiring human judgment.
3. **Ensemblis is handling** — current and planned autonomous work.
4. **Coming up** — relevant work in the next seven days.

Configuration, scores, system health, memory internals and feature inventory must not compete with this hierarchy.

Today should read like a good manager, not an admin console:

- Here is what matters.
- Here is what I need from you.
- Here is what I am handling.
- Here is what is coming next.

## Release as the hero object

A release is one Mission, not a collection of disconnected campaign, distribution, content and analytics products.

The artist-facing Release workspace has six facets:

1. **Overview** — Mission status, readiness and the next meaningful decision.
2. **Music** — canonical master, track intelligence, lyrics, stems and Best Moments.
3. **Content** — deliverables made from the release's musical evidence.
4. **Promotion** — the release promotion plan and meaningful checkpoints.
5. **Distribution** — DSP delivery, public listening destinations and publishing readiness.
6. **Results** — evidence translated into what Ensemblis recommends doing next.

Legacy process URLs such as `plan`, `create`, `publish` and `learn` may remain as compatibility aliases, but new product copy and navigation must use the artist-facing facets above.

Specialist campaign/provider controls remain one level deeper under Advanced views.

## Music and Best Moments

Music is the source of truth before marketing.

Ensemblis may use audio analysis, structure, lyrics, stems and performance calibration internally, but the artist should normally see a small editorial result rather than detection exhaust.

### Best Moments default

- Show at most the bounded curated set from the canonical Moment curator.
- Preserve complete musical phrases or sections rather than cropping to arbitrary social durations.
- Label picks in human editorial language such as Best Hook, Chorus Pick, Lyric Moment, Emotional Moment or Energy Moment.
- Show the exact time range and an immediate audition control.
- Explain why the Moment works in qualitative language.
- Show likely creative uses.
- Keep raw candidates, source modes, calibration metadata and detailed performance evidence behind progressive disclosure.
- It is acceptable to show no Moment when evidence is weak. Do not pad the list.

Artist corrections remain durable calibration evidence.

## Create: deliverable first

The default Create question is:

> What do you want to make?

It is not:

> Which AI engine do you want to run?

Ensemblis chooses or preserves the musical source, carries artist/release context and recommends a bounded set of useful deliverables.

Default behavior:

- Start from approved, curated musical Moments.
- Recommend a maximum of three strong directions.
- Keep outcome diversity.
- Preserve active Release context.
- Show an audio preview of the actual source.
- Keep rationale understandable and evidence-backed.
- Put specialist creation paths behind `Other ways to create`.

### Exact Moment lineage

When the artist explicitly chooses a Best Moment, that exact `moment.id` is canonical through the Create transition and into the production item.

Do not fall back to re-selecting another Moment from the same track. A visible artist choice must not be silently replaced by a ranking engine.

## Grow: career outcome, not a toolbox

Grow owns the questions:

- What is working?
- Where is the audience funnel constrained?
- What opportunity is worth acting on?
- What should the artist do next to grow?

Primary Grow views are:

- Overview
- Opportunities
- Audience
- Performance

Paid experiments, campaign controls, learning evidence, planning internals and portfolio diagnostics are advanced tools and should not compete with those four questions.

Metrics should be translated into a diagnosis or recommendation whenever possible. A dashboard of numbers without a decision is incomplete UX.

## Onboarding: value before configuration

The first-use sequence begins with real music and defers configuration until the system cannot infer the answer safely.

Canonical sequence:

1. Confirm artist identity when necessary.
2. Add one real mastered track.
3. Let Ensemblis understand the track.
4. Ask only the working preferences that music cannot reveal.
5. Start the appropriate Mission when the artist's goal calls for one.
6. Show the first useful editorial result, such as curated Best Moments.

Do not make connecting every service, completing a brand questionnaire or configuring automation a prerequisite for the first useful recommendation.

## Visual system

Ensemblis is the frame. The artist is the color.

The product UI should be calm, neutral, editorial and restrained so artwork, photography and generated/owned artist media can carry personality.

Rules:

- Use the canonical Design System tokens and primitives.
- High-level workflow composition belongs in `app/studio/design-system/workflows.css`.
- Avoid feature-specific visual languages for canonical workflows.
- Prefer hierarchy, spacing and typography over decorative effects.
- Semantic states may use restrained edge/accent treatment.
- Avoid gratuitous AI gradients, glow, excessive glass, decorative orbit effects and color-per-feature taxonomy.
- Progressive disclosure is preferred over visually representing every system capability at once.

## Interaction and trust rules

1. **Visible choices are durable.** If an artist selects a Moment, release, destination or preference, later automation must respect that exact source unless the UI asks to change it.
2. **Automatic work stays visible but quiet.** Ensemblis should explain what it is handling without turning every internal job into a task.
3. **Human interruption is scarce.** Needs You is for judgment, external effects, cost and destructive ambiguity, not routine bookkeeping.
4. **No fake precision.** Internal ranking may be numeric; artist-facing recommendations should use qualitative evidence unless a real measured metric is meaningful.
5. **No duplicate state systems.** Mission, Needs You and Today are projections over canonical domain state, not parallel task databases.
6. **Specialist complexity is preserved, not promoted.** Advanced tools remain available without defining the default mental model.

## Compatibility and migration

This architecture deliberately changes product hierarchy without deleting specialist functionality.

- Existing deep routes remain reachable where they are still operationally necessary.
- Old Release stage query parameters are normalized to the new facets.
- Existing engines, ranking systems, provider workflows and safety gates remain canonical implementation layers.
- Compatibility CSS may continue to exist during migration, but canonical workflow styling is owned by the Design System workflow layer.

## Acceptance contract

A future change should be rejected or redesigned if it does any of the following without a strong product reason:

- adds a sixth primary navigation destination;
- promotes an internal engine into a top-level artist concept;
- turns Today back into a comprehensive dashboard;
- makes Release users jump between separate campaign/distribution/content products for normal work;
- asks the artist to choose an AI provider before choosing a creative outcome;
- exposes raw Moment detections by default;
- silently replaces an artist-selected Moment during Create;
- puts Audience, Distribution, Memory or Connections back into generic navigation;
- exposes synthetic scores where qualitative evidence would be more honest;
- creates a parallel task/readiness state instead of projecting canonical domain state;
- adds another feature-specific visual system instead of extending canonical patterns.

The desired direction is consistent: **Ensemblis gets smarter; the interface gets simpler.**
