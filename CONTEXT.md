# Query Shaper

Query Shaper is a `<query-shaper>` web component that enhances a search input with
on-device AI: it interprets natural-language search text and offers suggestions
that make the eventual search more precise.

## Language

**Search Text**:
The raw natural-language string currently in the Target, before any interpretation.
_Avoid_: Query, raw query, input

**Target**:
The search input or textarea element a `<query-shaper>` enhances, referenced
via its `for` attribute (the target's `id`).
_Avoid_: Bound input, host input, search field

**Suggestion**:
A candidate improvement to the Search Text offered to the user, always a
single string the model writes as if it were a Lucene-style query — a plain
phrase for a simple rewording, or `field:value` syntax for a fielded/boolean
reformulation (an Expression, below). `<query-shaper>` decomposes that text
into field/value/operator tuples and re-renders it for the Target's actual
Format. A Suggestion isn't labeled or capped by *what kind* of improvement
it represents (fixing a typo, finishing an unfinished phrase, broadening
with related terms, reformulating as a fielded query) — the model mixes
whichever it judges useful for a given Search Text, in one flat list.
_Avoid_: Recommendation, candidate

**Expression**:
The shape a Suggestion's text takes when it contains fielded and/or boolean
query structure (e.g. `title:"climate change" AND year:2020`), mixing field
filters with bare, unscoped terms and boolean operators — as opposed to a
plain rewording with no such structure. Not a separate kind of Suggestion,
just a description of what its Lucene-style text looks like once parsed.
_Avoid_: Structured query, fielded query, boolean query, advanced query

**Accept**:
The user's action of choosing a Suggestion to act on.
_Avoid_: Select, apply, choose

**Action**:
The configurable behavior triggered when a Suggestion is Accepted: filling the
Target with the Suggestion's text (default), submitting the Target's form,
invoking an OpenSearch URL template, writing the text out to a separate
Destination (still also filling the Target, the same way submitting still
fills it first), or doing nothing beyond firing the Accept event and letting
the host decide.
_Avoid_: Accept mode, accept behavior, apply strategy

**Destination**:
The element(s) an accepted Suggestion's text is written to when Action is
set to write it out, matched by CSS selector; defaults to a `<query-shaper>`-
rendered element in its own Shadow DOM (the same place the downloadable-status
message appears) when no selector is given.
_Avoid_: Output target, sink, render target

**Fields**:
The description of what fields exist in the Target's backend, enabling
Expression-shaped Suggestions. Declared as free-form text, inline JSON, or
an imperative property. Without Fields, the model is never told about any
fields to reformulate against, and a Suggestion that references one anyway
is dropped rather than shown.
_Avoid_: Schema, field schema, index schema

**Examples**:
Optional, host-supplied few-shot demonstrations pairing a sample Search
Text with the Suggestions that would be good answers for it, primed
alongside Fields. Exists to steady the model toward real `field:value`
syntax for a specific backend's Fields, rather than describing a fielded
intent in prose without ever committing to the syntax.
_Avoid_: Samples, demonstrations, training data

**Notes**:
Optional, host-supplied free-form prose primed alongside Fields and
Examples — for domain-specific guidance (a business rule, a unit
convention, a disambiguation hint) that doesn't fit Examples'
input/Suggestion pair shape. Teaches by instruction, where Examples teach
by demonstration; declarative prompt tuning without touching code.
_Avoid_: Instructions, guidance, hints (as an attribute name)

**Format**:
The preset (or custom render function) that tells `<query-shaper>` how a
Suggestion's underlying field/value structure is rendered for a specific
backend — as a Lucene-style string, as URL parameters for facet-driven
backends, or via a custom render function for shapes neither preset covers.
Purely a rendering target: the model always writes Suggestions in Lucene
syntax regardless of Format, and `<query-shaper>` re-renders that into
whichever Format is configured.
_Avoid_: Syntax, query dialect, query syntax, render mode

**Base**:
The root URL a `url-params` Format optionally composes a full URL onto,
instead of rendering a bare query string. Accepts a relative path, absolute
path, or absolute URL; defaults to the current document's URL with its
query string and fragment stripped.
_Avoid_: Root, origin, endpoint base

**History**:
A bounded, recycling record of prior finalized queries, persisted in local
storage and fed back to the model as few-shot context for future
Suggestions. Each entry pairs the *original* Search Text with the Suggestion
that was Accepted for it (or, for a plain form submit with no Suggestion
involved, the submitted text against itself) — not just the final text
alone, since the pairing is what lets the model infer intent (what the user
was after) from precedent (what has worked for them before). Capped by a
configurable size; a cap of zero disables History entirely.
_Avoid_: Query history, prior queries, search history

**Headless**:
A mode in which `<query-shaper>` renders no suggestion popup of its own and
only emits Suggestion data via events, letting the host's own existing
suggestion UI consume and display it directly.
_Avoid_: Data-only mode, render mode
