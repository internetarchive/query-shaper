---
status: accepted
---

# `destination` stays a separate attribute, not folded into `action="output(...)"`

`destination` has no independent role — it's only ever read when
`action="output"`. That coupling raises an obvious question: would the
attribute surface be leaner by parameterizing the action value itself,
e.g. `action="output(.my-selector)"`, and dropping `destination`
entirely? The same question could be asked of `opensearch` and
`template`, which have the exact same relationship.

## Decision

Keep `destination` (and `template`) as separate, flat attributes. Do not
introduce a function-call-style parameterized action value anywhere in
the Element API.

## Considered Options

- **Fold `destination` into `action="output(...)"`.** Rejected — this
  would only be consistent if `opensearch`/`template` were changed the
  same way, and a URL template embedded inside a parenthesized action
  value is at least as awkward to parse and escape as a CSS selector is
  (see below). Changing one but not the other leaves two different
  parameterization styles for the same underlying situation, which is
  less consistent than today's one style (always a separate attribute),
  not more.
- **Fold both `destination` and `template` into their action values.**
  Rejected on parsing grounds: CSS selectors routinely contain
  parentheses themselves (`:not(.foo)`, `:nth-child(2)`, attribute
  selectors), so extracting a selector from inside `output(...)` means
  correctly parsing nested parens — real complexity for consumers to
  learn and for us to get right — versus a separate attribute value,
  which is an opaque string with no internal syntax at all. The
  "leaner surface" benefit is also narrow: most `action="output"` uses
  likely take the default built-in `<output>` and never set `destination`
  at all, so `action="output"` alone is already exactly as lean as the
  parameterized form would be — the extra syntax only pays for itself in
  the minority case that actually sets a custom selector, and for that
  case it's *more* to learn, not less.
- **Keep both as separate attributes (chosen).** Matches how every other
  attribute here works (`for`, `format`, `base`, `max-suggestions`) and
  how HTML attributes conventionally work generally (`<input min="0"
  max="10">`, not `type="range(0,10)"`) — the flat, separate-attribute
  shape is the unsurprising default, not the exception.

## Consequences

- No change to the Element API. `destination` (only meaningful for
  `action="output"`) and `template` (only meaningful for
  `action="opensearch"`) remain separate attributes, each documented
  alongside the `action` value that reads it.
- This question was asked directly during integration-docs work and is
  likely to come up again for the same reason — recorded here so it
  doesn't need to be re-litigated from scratch.
