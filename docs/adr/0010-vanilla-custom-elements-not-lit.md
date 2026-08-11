---
status: accepted
---

# Vanilla Custom Elements over Lit, revisited now the system's scope is known

SPEC.md's "Implementation defaults" section committed to "vanilla Custom
Elements (no Lit/framework runtime dependency)" up front — flagged, not
separately grilled. This revisits that choice now that the system's actual
shape is known, rather than leaving it as an unexamined assumption a later
reader has to take on faith (or re-litigate from scratch, as happened once
already — see GitLab #24).

## Decision

Stay with vanilla Custom Elements. No code change. The reasoning below is
more specific — and in one respect smaller — than the original one-line
justification, and names a real cost rather than glossing over it.

## Considered Options

- **Lit.** Rejected, but closer than the original one-line justification
  suggests:
  - The built bundle is 22.6KB unminified / 6.9KB gzipped. Lit's runtime is
    roughly 5KB gzipped on its own — adding it would mean roughly doubling
    the footprint of a component whose entire pitch is "attach this to a
    search input." For something meant to drop into arbitrary third-party
    pages, that's real friction: a consumer weighing whether to add it, or
    a host page that already carries a *different* Lit version (dedup/
    versioning risk that doesn't exist for a dependency-free component).
  - ADR-0001 (Chrome-native only) already removes the *other* classic
    reason to reach for Lit: smoothing over cross-browser Custom
    Elements/polyfill quirks. With exactly one modern engine to support,
    that whole class of pain doesn't apply here.
  - The project's actual trajectory (ADR-0006 removing SQL/REST-API
    Formats, ADR-0007 collapsing four Suggestion kinds into one string)
    consistently *removed* conditional-rendering complexity rather than
    growing it. The rendering surface that shipped — a popup list, a
    couple of status messages, one `<output>` — is small and updates
    infrequently, exactly the case where Lit's core value (efficient
    diffing over a frequently-changing template) barely gets exercised.
    The originally-envisioned, more complex scope might have tipped this
    closer; the system actually built didn't.
  - Against that, Lit's `@property()` (attribute reflection, converters,
    property-wins-over-attribute precedence) would have measurably
    reduced real, repetitive code — see Consequences. This is a genuine
    cost of the vanilla choice, not a hypothetical one.
- **Vanilla Custom Elements (chosen).** No added runtime, no version-skew
  risk with a host page's own framework choice, nothing to learn beyond
  standard platform APIs to maintain it.

## Consequences

- `fields`, `examples`, `notes`, `format`, and `base` each need the same
  attribute-or-property, property-wins pattern, hand-rolled as a
  getter/setter pair plus an `#xOverride`/`#hasXOverride` flag per
  attribute — about 85 lines (~10% of `query-shaper.ts`'s 890 lines) of
  bookkeeping a reactive-property system would have collapsed into a few
  declarations. Worth knowing before adding a sixth such attribute:
  the pattern is repetitive and each copy is a place to get the
  precedence rule subtly wrong.
- A large fraction of the genuinely hard engineering in this project —
  the grandparent/parent/child session hierarchy (ADR-0004), debounce
  +abort+destroy timing (ADR-0008), the retry loops, the
  pending-search-on-session-ready fix — is pure async state orchestration
  against `LanguageModel`, entirely orthogonal to whether the rendering
  layer is Lit or vanilla. That choice would not have made any of it
  easier or harder. The framework question mattered much less than it
  might have seemed at the outset — the hard-won problems here were never
  really about rendering.
