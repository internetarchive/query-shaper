---
status: accepted
---

# Unify the four Suggestion kinds into one Lucene-style string

`<query-shaper>` originally gave the model an explicit `kind` enum
(Correction/Completion/Expansion/Expression) and, for the fielded case, a
structured `fields` array to fill in directly — the model's job was to
classify each Suggestion by kind and, for Expression, hand back pre-
decomposed `{ field?, value, operator? }` tuples rather than text.

Across several rounds of live testing and instruction tightening, that
design kept surfacing the same underlying problem in new shapes:

- The model routinely crossed kind boundaries — a Completion firing on
  already-complete text, a Correction doing Expansion's job, near-duplicate
  Suggestions differing only by which kind label got attached. No amount of
  prompt wording made the classification reliable; each fix just moved the
  confusion to a different pair of kinds.
- Whenever a query genuinely couldn't be decomposed into the tuple shape
  Expression asked for, the model invented unsupported syntax — comparison
  operators the schema's `operator` field was never meant to hold — rather
  than declining to answer.
- The nested, conditionally-shaped response schema (branching on `kind`,
  requiring `fields` only for Expression) was measurably harder for
  Chrome's on-device constrained decoding to satisfy than a flat schema
  would be — live testing found calls that previously took a long,
  sometimes multi-second-per-retry wait.

## Decision

Collapse `Suggestion` to a single `string`, always written by the model as
if it were a real Lucene query — a plain phrase for a rewording, or
`field:value`/`AND`/`OR`/`+`/`-`/`[X TO Y]` syntax for a fielded/boolean
reformulation — with no `kind` tag and no separate structured-tuple channel
on the public type. The response schema becomes a flat `{ suggestions:
string[] }`. `<query-shaper>` decomposes that text itself, internally, via
a new `lucene-parser.ts` covering a deliberately restricted Lucene subset
(see SPEC.md's "Suggestion parsing and rendering"), rather than trusting
the model to supply pre-decomposed tuples.

Removing the kind boundary removes the crossing failure mode structurally
— there's no kind left for the model to get wrong — and a syntax the model
has seen far more of in training than any bespoke JSON tuple shape is both
easier for it to produce correctly and easier for the on-device engine to
decode against a much simpler schema.

This surfaced one real cost, addressed as part of the same decision: without
the old schema's *required, separate* `field`/`value` properties forcing
real decomposition, the model noticeably reverted to describing a fielded
intent in prose (mentioning a field name as a bare word, never writing the
colon) rather than committing to real Lucene syntax — especially once a
comparison it couldn't cleanly express was involved. Since a bare-word
sequence like that is syntactically valid (if meaningless) Lucene, the
parser's failure-to-parse drop doesn't catch it. The mitigation, added
alongside the collapse rather than as an afterthought: two new optional,
declarative attributes, `examples` (few-shot input → Suggestion-array pairs,
demonstrating the real `field:value` syntax wanted for a specific backend's
Fields) and `notes` (free-form prose for domain-specific guidance that
doesn't fit the input/Suggestion pair shape — a business rule, a unit
convention, a disambiguation hint). Both are primed once alongside Fields,
a pure prompt-content addition that doesn't touch the response schema, so
the latency win is unaffected.

## Considered Options

- **Keep the kind enum, tighten prompt wording further.** Rejected — this
  is what several rounds of live testing already tried; each fix relocated
  the crossing failure to a different pair of kinds rather than eliminating
  it, indicating the boundary itself was the problem, not the wording
  describing it.
- **Keep both a free-text channel and structured tuples, model picks per
  Suggestion.** Rejected — reintroduces the same conditionally-shaped
  schema (now branching on which channel a given Suggestion used) that
  caused both the kind-crossing confusion and the decoding latency cost in
  the first place; doesn't remove the failure mode, just renames it.
- **Collapse to one string without `examples`/`notes`.** Rejected — tried
  first; caused the prose-instead-of-syntax regression described above.
  `examples` was added specifically to fix this before the branch was
  considered done.

## Consequences

- `Suggestion` is now `string`; `HistoryEntry` drops its `kind` field
  (`{ searchText, suggestion, timestamp }`).
- The response schema is a flat `{ suggestions: string[] }` with `maxItems`
  the only structural constraint — no more conditional `required` branching
  on `kind`.
- New `src/lucene-parser.ts`: `extractFieldValues(text)` returns a
  `ParsedSuggestion` (`{ fields: FieldValue[]; hasFieldReference: boolean }`)
  or `null` for a genuine parse failure. An empty `fields` array is *not*
  an error — a Suggestion that's entirely one range (e.g. `price:[0 TO
  20]`) still renders verbatim for `format="lucene"`, while other Formats
  correctly drop it (nothing left to render as tuples). `hasFieldReference`
  is tracked independently so a bare range on an undeclared field is still
  caught by the "no Fields declared → drop" guard even though the range
  contributes nothing to the tuple array.
- The popup no longer groups Suggestions by kind — a flat list, in the
  order the model returned them.
- Live testing measured a real latency win from the schema simplification:
  results that previously took a long, sometimes multi-second-per-retry
  wait now typically return all `max-suggestions` results in 1–3 seconds
  (cold start still slower).
- `examples`/`notes` are new optional attributes/properties, JSON-or-
  freeform like `fields` (`examples`) or plain prose (`notes`), primed
  alongside Fields into the same one-time parent-session `append()` call —
  invalidated and rebuilt together with Fields under the same snapshot
  check.
