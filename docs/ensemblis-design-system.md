# Ensemblis Design System

Ensemblis Studio has one visual authority. Product chrome must never be invented by a route, feature, artist workspace, or legacy stylesheet.

## Runtime architecture

`app/studio/layout.tsx` imports exactly one stylesheet: `design-system/index.css`.

The cascade is intentionally ordered:

1. `ensemblis-compat` — legacy layout/composition rules after automatic token normalization
2. `ensemblis-tokens` — the only source of product visual values
3. `ensemblis-primitives` — reusable controls and surfaces
4. `ensemblis-patterns` — repeated product compositions and states
5. `ensemblis-shell` — navigation, workspace shell, auth and responsive mobile shell
6. `ensemblis-accessibility` — focus, touch targets, reduced motion and scroll behavior

A lower layer can describe geometry, but it cannot override canonical product chrome in a later layer.

## Token ownership

`app/studio/design-system/tokens.css` is the only active stylesheet allowed to declare `--en-*` product tokens.

The token vocabulary includes:

- background and surface roles
- ink, muted and subtle text roles
- line/border roles
- accent, violet, mint, danger and warning semantic roles
- radius scale
- spacing scale
- type scale, weights and line heights
- control heights
- motion durations and easing
- shadows and focus ring

Do not create `--s-*`, generic `--border`/`--card` aliases, feature-local color variables, or artist-specific product chrome.

## Primitive ownership

`primitives.css` owns reusable UI chrome including Button, text button, Field, status badges, PageHeader, Panel/Surface, EmptyState, table, tabs, disclosure and loading states.

`components/studio/ui.tsx` is the canonical React API for new reusable Studio UI. Prefer its `Button`, `ButtonLink`, `IconButton`, `PageHeader`, `Panel`, `Surface`, `EmptyState`, `Status`, `Field`, `Tabs`, `Disclosure` and `Submit` exports over creating another general-purpose control.

Feature components may create a genuinely domain-specific control when its interaction model is unique. Its colors, borders, radii, typography roles, focus state and motion must still come from Ensemblis tokens.

## CSS Modules

CSS Modules are appropriate for feature geometry and complex visualizations. They must consume `--en-*` tokens for product chrome. They may not contain raw hex/RGB/HSL product colors, `--s-*`, `--studio-surface`, or generic public-site tokens.

Waveforms, timelines and other music visualizations may own geometry that has no reusable product meaning. Their visual roles still use the Design System.

## Compatibility compiler

The pre-existing Studio stylesheets remain migration inputs while their route-specific layout rules are incrementally retired. They are never imported directly by the application.

`scripts/build-studio-css.mjs` compiles them into `legacy-compat.generated.css` and:

- removes legacy token declarations
- converts legacy aliases to `--en-*`
- maps raw colors to canonical semantic tokens
- normalizes reusable radii
- rejects any generated raw product color or legacy token leak

The generated file is ignored by Git and rebuilt on install, dev, Studio tests and production build. It always runs in the lowest cascade layer.

This compatibility layer is not a second Design System. It preserves route geometry while all runtime chrome resolves through the canonical Ensemblis system.

## Exceptions

`Viewport.themeColor` in `app/studio/layout.tsx` must be a literal because browser metadata cannot reference CSS custom properties. A contract test requires it to match `--en-bg` exactly.

Brand artwork files such as `public/ensemblis-mark.svg` contain their own SVG paint values. They are assets, not product CSS chrome.

## Enforcement

`tests/ensemblis-design-system-contract.test.mjs` blocks regressions by verifying:

- one Studio stylesheet entrypoint
- one token authority
- canonical cascade order
- token-only compiled compatibility CSS
- token-only Studio CSS Modules
- primitive ownership
- compiler execution on install/dev/test/build
- synchronized browser theme metadata

The existing visual and UX contract suites additionally protect identity, navigation, responsive behavior, workflow semantics and accessibility.

## Adding UI

Before adding a new style, ask in this order:

1. Is there already a primitive in `components/studio/ui.tsx`?
2. Is this a repeated pattern that belongs in `patterns.css`?
3. Is it feature-specific geometry that belongs in a CSS Module?
4. Does it need a new semantic token? If yes, add the token to `tokens.css` first and use it everywhere.

Do not solve a visual difference with a new late override stylesheet.
