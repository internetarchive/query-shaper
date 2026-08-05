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
Expansion, and Structured Query is a kind of Suggestion.
_Avoid_: Recommendation, candidate

**Correction**:
A Suggestion that fixes a likely typo or misspelling in the Search Text.
_Avoid_: Typo fix, spell check

**Expansion**:
A Suggestion that broadens the Search Text with related terms, synonyms, or
alternate phrasings to widen recall.
_Avoid_: Query expansion, synonym suggestion

**Structured Query**:
A Suggestion that reformulates the Search Text as a fielded and/or boolean query
(e.g. `title:"climate change" AND year:2020..2023`). Field filters and boolean
operators are both part of this single concept, not separate suggestion kinds.
_Avoid_: Fielded query, boolean query, advanced query

**Accept**:
The user's action of choosing a Suggestion to act on.
_Avoid_: Select, apply, choose

**Action**:
The configurable behavior triggered when a Suggestion is Accepted: filling the
Target with the Suggestion's text (default), submitting the Target's form, or
invoking an OpenSearch URL template.
_Avoid_: Accept mode, accept behavior, apply strategy
