# Lyrics Intelligence

Lyrics Intelligence is Atlas Irwin's canonical understanding of what a track says and means. It is a peer to Track Intelligence and Stem Intelligence, not a separate content tool.

## Source-of-truth model

Atlas keeps three layers deliberately separate:

1. **Official lyrics** — exact artist-provided words. This is canonical human truth and Atlas never rewrites it silently.
2. **Structured lyrics** — sections, lines, section labels and optional timing. Structure is AI-assisted and editable.
3. **Lyrics Intelligence** — themes, meaning, imagery, emotional arc, hook phrases, visual opportunities and Lyric Moments. This is derived intelligence tied to an exact lyrics version.

Every edit to the canonical text, language or vocal/instrumental state creates a new lyrics version and immutable revision record. AI analysis and Lyric Moments are version-specific so stale interpretation is never reused as if it belonged to the new words.

## Artist workflow

Inside a release's source-material workflow:

- paste the exact official lyrics once;
- optionally provide the language;
- choose whether Atlas may use semantic lyric context;
- choose whether exact approved lyric excerpts may appear publicly in generated media;
- click **Save & analyze lyrics**;
- or explicitly mark a track **Instrumental**.

Atlas parses obvious section labels immediately, analyzes meaning and structure through the existing Atlas AI Control Plane, aligns compatible sections with current Track Intelligence, and ranks useful Lyric Moments.

The default workflow does not require manual timestamps or a second Lyrics app.

## Lyric Moments

A Lyric Moment is an operational creative object grounded in an exact official excerpt. It can carry:

- an exact excerpt;
- section identity;
- interpretation;
- creative-purpose tags;
- visual directions;
- semantic usefulness score;
- Track Intelligence section timing;
- overlapping musical hook-candidate score;
- source-master and music-analysis provenance.

When both signals exist, Atlas combines semantic usefulness with musical hook strength. This gives downstream systems a song-specific moment rather than a disconnected quote or generic audio timestamp.

## Track and master provenance

Replacing the canonical audio master does **not** delete lyrics or their semantic meaning. It invalidates only timing derived from the previous master:

- automatic lyric-section timing;
- automatic lyric-line timing;
- timed Lyric Moments;
- music-section and hook-candidate linkage.

Manual lyric timing is preserved. The next analysis can align the same words to the new master.

Editing the lyrics works in the opposite direction: the canonical lyrics version changes, making prior derived semantic intelligence stale while preserving immutable revision history.

## Shared creative context

Downstream systems consume `TrackLyricsContext` rather than reading lyrics tables independently.

The shared context intentionally does not dump the full lyric sheet into every model call. It supplies compact semantics, structure, approved hooks and the strongest Lyric Moments. This reduces prompt noise and establishes one permissions model across Atlas.

### Marketing and Campaign Brain

All structured marketing AI is automatically enriched with Lyrics Intelligence when a release is present. Campaign planning, caption writing and strategy can therefore use actual song meaning, imagery and approved lyric fragments without bespoke per-feature wiring.

The marketing visual context also combines lyric semantics with Audio Scene selection. A lyric-led brief can therefore favor vocal spotlight or vocal-to-drop stem treatments when they are musically appropriate.

### Video Director

Video Director receives Lyrics Intelligence beside the music map and Stem Intelligence. Concepts and storyboards can combine:

- lyrical narrative and emotional arc;
- timed Lyric Moments;
- Track Intelligence sections, edit points and hook candidates;
- stem-aware Audio Scenes and musical treatments.

Lyrics should inform visual causality, not force literal illustration. Timed lyrical payoff and musical payoff can reinforce each other when useful.

## Quote safety

Public lyric text has a strict grounding rule:

- only excerpts present exactly in the canonical lyrics may become approved hook phrases or Lyric Moments;
- downstream context exposes lyric text only when the relevant quote permissions allow it;
- models are explicitly instructed never to invent, complete, reconstruct or paraphrase text as if it were an official lyric.

Semantic meaning may still inform creative direction when public quoting is disabled, provided AI-context usage itself is enabled.

## Current timing scope

The first production version aligns lyric **sections** to compatible Track Intelligence sections and can tighten Lyric Moment windows around overlapping Track Intelligence hook candidates.

It does **not** claim word-level karaoke synchronization. The schema already supports line timing so a future forced-alignment worker can add precise line or word timing without changing the canonical lyrics architecture.

## Why this is one system

The intended intelligence stack is:

- **Track Intelligence** — where the musical moments are;
- **Stem Intelligence** — what sonic elements are happening and how they can be treated;
- **Lyrics Intelligence** — what is being said and meant;
- **Brand Intelligence** — what Atlas Irwin should look and feel like;
- **Campaign Intelligence** — what outcome the release is trying to achieve;
- **Creative Intelligence** — what should be made now from all of the above evidence.

No downstream feature should invent its own lyric parser, lyric permissions, or separate interpretation cache.