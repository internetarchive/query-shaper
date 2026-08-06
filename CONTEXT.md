# Query Shaper

Query Shaper is a `<query-shaper>` web component that enhances a search input with
on-device AI: it interprets natural-language search text and offers suggestions
that make the eventual search more precise.

## Language

**Search Text**:
The raw natural-language string currently in the Target, before any interpretation.
_Avoid_: Query, raw query, input

**Target**:
The search input element a `<query-shaper>` enhances, referenced via its `for`
attribute (the target's `id`).
_Avoid_: Bound input, host input, search field

**Suggestion**:
A candidate improvement to the Search Text offered to the user. Every Correction,
Expansion, and Expression is a kind of Suggestion.
_Avoid_: Recommendation, candidate

**Correction**:
A Suggestion that fixes a likely typo or misspelling in the Search Text.
_Avoid_: Typo fix, spell check

**Expansion**:
A Suggestion that broadens the Search Text with related terms, synonyms, or
alternate phrasings to widen recall.
_Avoid_: Query expansion, synonym suggestion

**Expression**:
A Suggestion that reformulates the Search Text as a fielded and/or boolean query
(e.g. `title:"climate change" AND year:2020..2023`), which may mix field
filters with bare, unscoped terms. Field filters, bare terms, and boolean
operators are all part of this single concept, not separate suggestion kinds.
_Avoid_: Structured query, fielded query, boolean query, advanced query

**Accept**:
The user's action of choosing a Suggestion to act on.
_Avoid_: Select, apply, choose

**Action**:
The configurable behavior triggered when a Suggestion is Accepted: filling the
Target with the Suggestion's text (default), submitting the Target's form, or
invoking an OpenSearch URL template.
_Avoid_: Accept mode, accept behavior, apply strategy

**Fields**:
The description of what fields exist in the Target's backend, enabling
Expression suggestions. Declared as free-form text, inline JSON, or an
imperative property; without Fields, only Correction and Expansion Suggestions
are offered.
_Avoid_: Schema, field schema, index schema

**Format**:
The preset (or custom render function) that tells `<query-shaper>` how to
render an Expression's field/value pairs into a specific backend's actual
query format — e.g. a Lucene-style string, or URL parameters for facet-driven
backends.
_Avoid_: Syntax, query dialect, query syntax, render mode

**History**:
A bounded, recycling record of prior finalized queries — Search Text that was
submitted, and/or Suggestions that were Accepted — persisted in local storage
and fed back to the model as extra context for future Suggestions. Capped by a
configurable size; a cap of zero disables History entirely.
_Avoid_: Query history, prior queries, search history

**Headless**:
A mode in which `<query-shaper>` renders no suggestion popup of its own and
only emits Suggestion data via events, letting the host's own existing
suggestion UI consume and display it directly.
_Avoid_: Data-only mode, render mode
