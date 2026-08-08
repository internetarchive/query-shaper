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
A candidate improvement to the Search Text offered to the user. Every Correction,
Completion, Expansion, and Expression is a kind of Suggestion.
_Avoid_: Recommendation, candidate

**Correction**:
A Suggestion that fixes a likely typo or misspelling in the Search Text.
_Avoid_: Typo fix, spell check

**Completion**:
A Suggestion that finishes the Search Text when it looks like an unfinished
word or phrase — the same intent, just completed, not corrected or
broadened (e.g. `new y` → `new york`). Distinct from Expansion, which
assumes the Search Text is already a complete thought and adds related
terms around it, not more letters to the same one; the test is whether the
Search Text reads as truncated mid-word/mid-phrase (Completion) or as a
finished thought that could simply use company (Expansion).
_Avoid_: Autocomplete, prefix match, suggestion

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
Expression suggestions. Declared as free-form text, inline JSON, an
imperative property, or — for backends with more than one Resource (e.g. a
SQL database's tables) — a JSON object keyed by Resource name, each holding
its own field list. Without Fields, only Correction and Expansion Suggestions
are offered.
_Avoid_: Schema, field schema, index schema

**Format**:
The preset (or custom render function) that tells `<query-shaper>` how an
Expression's rendered text is arrived at for a specific backend — either by
rendering field/value pairs itself (a Lucene-style string, URL parameters for
facet-driven backends, REST query parameters against a chosen Resource
endpoint, or a custom render function), or by having the model author the
text directly, as with SQL, where field/value pairs can't capture joins,
projections, or ordering.
_Avoid_: Syntax, query dialect, query syntax, render mode

**Resource**:
The table, file, table-valued expression (e.g. `read_csv('data.csv')`), or
REST API endpoint path a Fields entry's columns or query parameters belong
to. Named — not "Table" or "Endpoint" — because it covers files, function
calls, and API routes equally, not just literal database tables.
_Avoid_: Table, source, from, endpoint

**Base**:
The root URL a `rest-api` Format composes a chosen Resource's path and query
parameters onto (and that a `url-params` Format optionally composes a full
URL onto, instead of rendering a bare query string). Accepts a relative
path, absolute path, or absolute URL; defaults to the current document's URL
with its query string and fragment stripped.
_Avoid_: Root, origin, endpoint base

**History**:
A bounded, recycling record of prior finalized queries, persisted in local
storage and fed back to the model as few-shot context for future
Suggestions. Each entry pairs the *original* Search Text with the Suggestion
that was Accepted for it (or, for a plain form submit with no Suggestion
involved, the submitted text against itself) and that Suggestion's kind —
not just the final text alone, since the pairing is what lets the model
infer both intent (what the user was after) and precedent (what kind of
Suggestion, and what shape of answer, has worked for them before). Capped
by a configurable size; a cap of zero disables History entirely.
_Avoid_: Query history, prior queries, search history

**Headless**:
A mode in which `<query-shaper>` renders no suggestion popup of its own and
only emits Suggestion data via events, letting the host's own existing
suggestion UI consume and display it directly.
_Avoid_: Data-only mode, render mode
