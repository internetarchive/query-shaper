# Query Shaper — Spec

Synthesizes the design session recorded in `CONTEXT.md` (vocabulary) and
`docs/adr/` (the hardest-to-reverse calls) into something implementable.

Everything under **Element API** and **Generation flow** reflects a decision
actually made during grilling. Exact attribute/event _names_ are a first
proposal, not separately grilled — treat them as easy to rename, not settled
architecture.

## Non-goals for v1

- Cross-browser support beyond Chrome (ADR-0001)
- Dynamic collection-switching for multi-collection backends like Wayback's
  (deferred per the collection-scope decision below; revisit if a unified
  cross-collection search box shows up later)
- A full i18n/labels override system (hardcoded English strings for now,
  structured so promoting one to an attribute is additive, not a rewrite)
- Reading `<datalist>` options as passive vocabulary input (plausible future
  idea, not committed)

## Element API

**`for`** (attribute, required): id of the Target — an `<input>` or
`<textarea>`.

**`fields`** (attribute or `.fields` property): Fields declaration. The
attribute value is JSON-parsed first; if that fails, treated as a free-form
description string (e.g. `"title, author, language:iso-639-1, date (allowed
patterns YYYY[-MM[-DD]]), categories (comma-separated list)"`). The parsed
JSON form is a bare array of field descriptors. The `.fields` property
always wins when both are set. Absent entirely → the model is never told
about any fields; a Suggestion that references one anyway is dropped
rather than shown (see "Generation flow" below).

**`examples`** (attribute or `.examples` property, optional): few-shot
input/Suggestion pairs primed alongside Fields, one time, into the same
parent-session message — invalidated and rebuilt together with Fields
under the same snapshot check. JSON-parsed first (an array of `{ input:
string; suggestions: string[] }`, each entry's Search Text paired with
every good Suggestion for it — an array, matching the real shape
`query-shaper-suggestions` returns, since an input can have more than one
valid answer); if parsing fails, treated as a free-form string passed
through as-is, same fallback as `fields`. Exists because free-text
Suggestion generation (see "Generation flow" below) turned out to need
concrete, backend-specific demonstrations of real `field:value` syntax
more than the old tuple-schema design did — without it, the model
noticeably reverts to describing intent in prose (mentioning a field name
as a bare word, never actually writing the colon) rather than committing
to real Lucene syntax, especially for anything comparison-shaped. A couple
of relevant, correctly-written examples measurably steadies this, without
touching the response schema — so the schema-simplicity latency win
(see below) is unaffected.

**`base`** (attribute, optional): the root URL that `format="url-params"`
optionally composes a full URL onto instead of rendering a bare query
string (see the `url-params` entry below). Accepts a relative path, an
absolute path, or an absolute URL — resolved via `new URL(base,
document.baseURI)`, so it behaves exactly like any other relative URL
resolution in the browser, no special-casing needed for the three forms.
Defaults, when absent, to the current document's URL with the query string
and fragment stripped (`new URL(document.baseURI)` with `.search`/`.hash`
cleared).

**`format`** (attribute): a built-in preset name telling query-shaper how to
render a Suggestion's underlying field/value structure for a specific
backend. This is purely a rendering target — the model always writes every
Suggestion as Lucene-style text regardless of `format` (see "Generation
flow" below); query-shaper parses that text once and renders it per the
configured preset:

- `lucene` — the model's own text is used verbatim, since it's already
  meant to be Lucene syntax; there's no separate rendering step to apply.
  `field:value` tokens, space-separated, boolean operators; a bare,
  unscoped term mixes freely with fielded clauses in one query (e.g.
  `climate change title:"policy"`), matching real Lucene.
- `simple-query-string` — the classic `+required -excluded "exact phrase"`
  prefix-operator style: `+` marks a term required, `-` marks one excluded,
  no prefix means optional/should-match, and quoted values are preserved as
  exact phrases. Matches Elasticsearch's `simple_query_string` query and
  MySQL's boolean full-text mode, and is what most people mean by
  "traditional web search syntax." Bare terms are the primary case here;
  field-scoped terms (`+title:foo`) are supported but secondary. Since
  quoting means "exact phrase" here — not just a fielded-value disambiguator
  like in `lucene` — a multi-word value is quoted whether bare or fielded,
  same deterministic rule query-shaper applies when re-rendering the
  parsed tuples, regardless of how the model itself originally quoted them.
- `url-params` — field/value pairs rendered as URL query parameters. When a
  **`base`** attribute is set, the rendered text is the full URL (`base` +
  `?` + the query string) rather than a bare query string; when `base` is
  absent, behavior is unchanged from today (bare query string).
- Imperative-only escape hatch: a `.format` property accepting a custom render
  function, for shapes neither preset covers. Since it's a function over
  `FieldValue[]`, it can only ever operate on decomposed tuples, never raw
  model-authored text.

**`action`** (attribute): one of `fill` (default), `submit`, `opensearch`,
`output`, `none`.

- `submit` fills the Target, then submits its form (unchanged).
- `output` fills the Target, then also writes the Suggestion's text to the
  **`destination`** attribute's matched element(s) — see below.
- `none` does neither fill nor navigate nor write anywhere; `query-shaper-accept`
  still fires and History still records, but the host handles everything
  else itself. Orthogonal to `headless` — `headless` controls whether
  query-shaper renders its own popup at all; `none` controls what `accept()`
  does once called, regardless of who called it (query-shaper's own popup,
  or a host's UI in headless mode). Combining `headless` × `{fill|none}`
  covers all four points on that matrix, including the previously-impossible
  "native popup, fully custom accept-handling."

`opensearch` requires a **`template`** attribute/property holding a
`{searchTerms}`-style URL template (placeholder may appear in a path segment,
not just a query string — see the Wayback example below).

**`destination`** (attribute, only meaningful for `action="output"`): a CSS
selector (`document.querySelectorAll`, not `id` — unlike the Target, a
Destination can legitimately be more than one element) identifying where to
write the accepted Suggestion's text. Sets `.value` for `<textarea>`/`<input>`
matches, `.textContent` otherwise. Absent → defaults to an `<output>` element
query-shaper renders in its own Shadow DOM, in the same popup container the
downloadable-status message uses.

**`max-suggestions`** (attribute): cap on the total number of Suggestions
returned, defaulting to 5. Enforced twice: as `maxItems` on the response
schema (a structural constraint on the model's own output) and again in
code after parsing/filtering (never fully trust a model to honor a
schema constraint — see "Generation flow" below).

**`max-history`** (attribute): cap on stored History entries, and on how many
are fed back into generation as context. `0` disables History — turns off
recording, stops using it as context, **and clears any existing entries**
already stored under this instance's key.

**`history-key`** (attribute, optional): overrides the localStorage
partition key for History. Defaults to the Target's `id` (always available,
since `for` requires one) — set this only when multiple instances should
deliberately _share_ one History.

Each stored entry is `{ searchText, suggestion, timestamp }` — the
*original* Search Text, the Suggestion text that was Accepted for it, and a
`timestamp` (epoch ms) kept for debugging only, never fed into a prompt.
For a plain form submit with no Suggestion involved, `searchText` and
`suggestion` are the same value. Storing the pairing, not just the final
text, is what makes History function as few-shot context rather than a
flat log: the model can see both what the user meant (the original text)
and what has actually worked for them recently — not merely a list of past
queries with no signal about which parts of them were useful.

Reads are served from an in-memory cache, primed once from localStorage on
first access rather than on every generation call — that's the hot path,
running on every debounced query, and doesn't need to touch storage that
often. Writes (Accept, form submit — much rarer) stay immediate, always
re-reading localStorage fresh rather than trusting the cache before merging
and writing back, so two instances deliberately sharing a `history-key`
interleave correctly instead of one silently overwriting the other's
contribution with a stale in-memory copy.

**`headless`** (boolean attribute): renders no popup UI; only emits the
events below. Lets a host with its own existing suggestion widget consume
Suggestion data directly instead of fighting two competing popups.

Regardless of `headless`, query-shaper sets `autocomplete="off"` on the
Target by default (its own popup replaces what native browser autocomplete
would otherwise show, and that native dropdown can't be reliably suppressed
any other way).

### Events

All fired on the `<query-shaper>` element itself, as `CustomEvent`s carrying
data in `detail`:

- **`query-shaper-suggestions`** — a new suggestion set is ready. `detail:
{ suggestions: Suggestion[] }`
- **`query-shaper-accept`** — a Suggestion was Accepted. `detail: {
suggestion, action }`
- **`query-shaper-status`** — model/session lifecycle transition (see below).
  `detail: { status: 'unavailable'|'downloadable'|'downloading'|'available' }`
- **`query-shaper-error`** — a generation call failed (prompt error, quota
  exceeded, unrecoverable context overflow). `detail: { error, phase }`. The
  Target itself never breaks — this is purely an observability seam.

### Suggestion shape

```ts
type Suggestion = string;
```

Every Suggestion is a single string, always written by the model as if it
were a Lucene-style query (see "Generation flow" below) — a plain phrase
for a simple rewording, or `field:value` syntax (with `AND`/`OR`/`+`/`-`,
quoted phrases, and `[X TO Y]` ranges) for a fielded/boolean reformulation.
There's no `kind` tag and no separate structured-tuple channel on the
public type: query-shaper parses that Lucene-style text internally into
`{ field?, value, operator? }` tuples (an entry with no `field` is a bare,
unscoped term) and re-renders it per the configured Format before it ever
reaches `query-shaper-suggestions` — see the "Suggestion parsing and
rendering" note below for exactly what's parsed, downgraded, or dropped.

This collapses what were previously four separate Suggestion kinds
(Correction, Completion, Expansion, Expression) into one undifferentiated
string. That's a deliberate simplification, not an oversight: extensive
live testing found the model repeatedly crossing the boundaries between
kinds — a Completion firing on already-complete text, a Correction doing
Expansion's job, near-duplicate Suggestions differing only in which kind
label was attached — and no amount of instruction-wording made the
distinction reliable. Removing the boundary removes the failure mode
structurally: there's no kind left for the model to get wrong.

### Suggestion parsing and rendering

`lucene-parser.ts` covers a deliberately restricted subset of real Lucene
syntax — chosen to match what the model realistically writes and what
query-shaper's Formats can faithfully represent, not full Lucene:

- **Gate**: a string with no field:value colon, no standalone `AND`/`OR`/
  `NOT`, no leading `+`/`-`, and no more than one quoted segment is treated
  as one opaque bare phrase and never tokenized — this is what keeps a
  plain rewording ("the eiffel tower in paris") from being mis-split into
  several independent bare terms once rendered for a tuple-based Format.
- **Core grammar** (renders losslessly for every Format): bare terms,
  quoted phrases, `field:value`, `AND`/`OR`/`+`/`-`/`NOT`, implicit
  (operator-less) juxtaposition.
- **Extended grammar** (parsed, then downgraded or dropped per Format):
  parenthesized groups (flattened if every clause inside shares one
  operator and none is itself nested; dropped otherwise), field-scoped
  groups (`category:(a OR b)`), ranges (`field:[X TO Y]`, dropped — no
  Format has a way to represent one), wildcards (kept as literal
  characters), fuzzy (`~`/`~N`, stripped), boost (`^N`, stripped).
- **Failure**: a syntax error (unterminated quote/range/paren, a field
  with no value) drops the whole Suggestion rather than showing broken
  text.

For `format="lucene"`, a Suggestion that passes the parseability check is
rendered **verbatim** — there's no reconstruction step, since the model's
text is already meant to be Lucene. Every other Format (`url-params`,
`simple-query-string`, a custom `.format` function) renders the parsed
`{ field?, value, operator? }` tuples through the same deterministic
rendering rules as before (quoting a multi-word value, applying an
operator's Format-specific meaning, etc.).

## Generation flow

1. **First focus** on the Target: call `LanguageModel.availability()`.
   - `unavailable` → do nothing; fully inert, standard input behavior.
   - `available` → establish this instance's session per the grandparent/
     parent/child hierarchy (ADR-0004): the page-wide shared "grandparent"
     base session is created once (seeded with a generic, Fields-agnostic
     system instruction via `initialPrompts`); this instance's "parent" is
     `clone()`d from it and primed once with this instance's Fields
     description via `append()`. The parent is reused for this instance
     going forward — but never prompted directly; see step 2.
   - `downloadable` → (unless `headless`) show an unobtrusive inline message
     inviting the user to enable client-side search enhancement, with a
     button to trigger the download and a dismiss option. Dismissal is
     remembered in localStorage (origin-scoped) so it doesn't reappear.
   - `downloading` → (unless `headless`) show an inline, buttonless
     informational message (a download is already in progress — there's
     nothing to trigger or dismiss, just wait) — and proceed to establish
     the session anyway, since `create()` itself waits out an in-progress
     download rather than requiring a fresh trigger. Once it resolves, the
     message clears and a second `query-shaper-status` event fires with
     `available`, reflecting the real transition.

   Both `availability()` and the grandparent's `create()` are called with
   the same `expectedInputs`/`expectedOutputs` options (`{ type: "text",
   languages: [...] }`) — the Prompt API otherwise warns that it can't
   attest output-safety for an unspecified language, and passing mismatched
   options to the two calls is explicitly discouraged upstream. The language
   comes from `document.documentElement.lang` (first subtag, lowercased),
   falling back to `en` when unset or not currently one of the model's
   supported languages (`de`, `en`, `es`, `fr`, `ja`).
2. **Debounced input** (~400ms pause — a starting point, expected to need
   empirical tuning against real model latency): if Fields changed
   imperatively since the parent was primed, rebuild it first (destroy the
   stale one, clone fresh from the grandparent, re-`append()`). Then clone a
   disposable "child" from the parent and build **one** prompt call — just
   History (most recent entries up to `max-history`) and the current Search
   Text, since the generic instruction and Fields both live upstream in the
   grandparent/parent already (the model is never told the Format — see
   below). Use `responseConstraint` with a JSON Schema requiring a flat
   array of strings, capped at `max-suggestions` via `maxItems`. No staged/
   sequential pass — one call, one response. The child is `destroy()`ed
   once the call settles (success, failure, or abort) — it only ever exists
   for this one query.

   The upstream instruction carries everything the schema can't enforce
   structurally: this is a keyword search system, not a chat assistant —
   every Suggestion must read like something typed into a search box, never
   a descriptive sentence, an explanation, or a list, and no
   sentence-ending punctuation; up to `max-suggestions` reasonable
   alternative or refined queries, which may fix a typo, complete an
   unfinished phrase, broaden with related terms, or (when Fields are
   described) reformulate as a fielded/boolean query, in any mix, never
   labeled by which of these a given one is; each written as if it were a
   real Lucene query — a plain phrase for a rewording, `field:value`/
   `AND`/`OR`/`+`/`-`/`[X TO Y]` for a fielded/boolean one, using only the
   described Fields, never inventing one that isn't described; never a
   Suggestion identical to the Search Text; each as its own separate
   string, never bundling more than one idea into one string with a comma
   or "and".

   This replaced an earlier design that gave the model an explicit `kind`
   enum (Correction/Completion/Expansion/Expression) and a structured
   `fields` array to fill in for the fielded case. Across several rounds of
   live testing and instruction tightening, that design kept surfacing the
   same underlying problem in new shapes: the model crossing kind
   boundaries (a Completion firing on already-complete text, a Correction
   doing Expansion's job, near-duplicate Suggestions differing only by
   which kind label was attached) and inventing unsupported syntax
   (comparison operators the schema's `operator` field was never meant to
   hold) whenever a query genuinely couldn't be decomposed into the tuple
   shape it was asked for. Collapsing to one plain Lucene-style string per
   Suggestion — a syntax the model has seen far more of in training than
   any bespoke JSON tuple shape — removes the kind-boundary failure mode
   structurally rather than patching it further; see "Suggestion parsing
   and rendering" above for how query-shaper decomposes that string itself
   instead of trusting the model to supply pre-decomposed tuples.

   Live testing confirmed a real, sizable latency win from this
   simplification too: a flat `{ suggestions: string[] }` schema is far
   easier for Chrome's on-device constrained decoding to satisfy than the
   old nested, conditionally-shaped object schema — results that previously
   took a long, sometimes multi-second-per-retry wait now typically return
   all 5 Suggestions in 1–3 seconds (cold start still slower). The same
   testing also surfaced a real cost specific to the fielded case: without
   the old schema's *required, separate* `field`/`value` JSON properties
   forcing real decomposition, the model noticeably reverts to describing
   a fielded intent in prose — mentioning a field name as a bare word
   without ever writing the colon, or inventing a field that was never
   declared — especially once a comparison it can't express is involved.
   Since a bare-word sequence like that is syntactically valid (if
   meaningless) Lucene, it isn't caught by the parse-failure drop below.
   The mitigation is the `examples` attribute (see Element API above):
   a couple of concrete, backend-specific input → Suggestion pairs primed
   alongside Fields, demonstrating the real `field:value` syntax wanted —
   a pure prompt-content addition that doesn't touch the schema, so the
   latency win is unaffected.

   A string that fails to parse as valid Lucene-style syntax, or that
   references a field despite none being declared, is dropped entirely
   rather than shown broken or untrustworthy — a smaller set of
   trustworthy Suggestions beats one with an unusable entry in it. `format`
   is the one exception: a Suggestion whose text merely doesn't parse as
   *structured* (no recognizable field/operator syntax at all) is treated
   as a single opaque phrase and shown as-is for `format="lucene"`
   regardless — the model can still write something syntactically odd
   there (e.g. `year=2020` instead of `year:2020`) and see it rendered
   unvalidated, since `lucene` is verbatim passthrough by design.

   Debouncing only cancels a *pending* timer, not an already-started model
   call — real on-device latency means a call from an earlier pause can
   still be in flight when a later one starts. Each call is tagged with a
   monotonically increasing generation id at start; a result is rendered
   only if its id still matches the latest one when it resolves, so a
   slower, older call can never overwrite a fresher one's Suggestions,
   regardless of resolution order.

   Two refinements on top of that: a pause that only changed leading/
   trailing whitespace (the trimmed Search Text is unchanged) never starts
   a new call at all — pure cursor movement never reaches this point either,
   since it doesn't fire an `input` event in the first place. When a pause
   *does* produce a genuinely different Search Text, the previous in-flight
   call is aborted (`AbortSignal`, which the Prompt API's `prompt()`
   supports) rather than merely ignored, so the device stops spending
   compute on a call whose result is about to be discarded anyway.

   A rendered Suggestion identical (after trimming) to the current Search
   Text is dropped before rendering — every Suggestion is meant to be a
   better alternate, and echoing the input back verbatim isn't one.
3. **Render**: a flat list in the order the model returned them (already
   instructed to sort by relevance), up to `max-suggestions` total —
   unless `headless`, in which case only `query-shaper-suggestions` fires.
4. **Accept**: apply `action` (fill the Target / submit its form / navigate
   via the `opensearch` template / fill the Target and also write to
   `destination` / do nothing beyond the event below); emit
   `query-shaper-accept`; record a History entry (`action="none"` still
   records — the Suggestion was genuinely Accepted, regardless of what, if
   anything, happens to any Target/Destination as a result).
5. **History finalization triggers** (deduped so one user action never logs
   twice): a native form submit fires: record current Search Text. A
   Suggestion is Accepted with an Action that doesn't itself trigger a submit
   (`fill`, `output`, `none`): record it directly. An `opensearch` Action is
   invoked (navigation): record it. `submit` with no `<form>` on the Target
   falls back to recording directly, since no submit event will ever fire.
6. **Context overflow**: if the combined prompt risks exceeding the model's
   context window, proactively trim the _oldest_ History entries first
   (before touching Fields/Search Text) and retry, rather than surfacing
   an error for something the user configured a number for.
7. **Transient model errors**: a `responseConstraint` call can fail with a
   generic `UnknownError` that isn't tied to any specific schema shape —
   observed to be intermittent (the same schema succeeds on one call and
   fails on the next), consistent with Chrome's on-device model still being
   actively developed. Retried up to twice before giving up.
8. **Any other failure**: emit `query-shaper-error`; that generation cycle
   simply shows no suggestions; the Target keeps working as a plain input.

## Demo plan

A single demo page with multiple `<query-shaper>` instances. `Accept`
navigates to a results page against that instance's real backend — no
inline result-fetching in any case.

1. **Internet Archive** (`archive.org/advancedsearch.php`) — Fields:
   `mediatype`, `year`, `creator`, `subject`, `language`; Format: `lucene`
   (confirmed CORS-open, confirmed query syntax via research — no published
   OpenSearch doc, so the URL template is hand-built).
2. **Open Library** (`openlibrary.org/search.json`) — Fields: `author`,
   `title`, `language` (ISO 639), `first_publish_year`; Format: `lucene`; the
   `template` can be sourced from the real OpenSearch description document at
   `openlibrary.org/static/opensearch.xml`.
3. **Wayback Machine collection-search**, `gov` collection — Fields:
   `language`, `site`, `year`, `pubdate` (the collection itself, e.g. `gov`,
   is fixed per-instance configuration baked into the `template`, never a
   Field a Suggestion varies — collections have their own namespaced
   pages today, not a single unified search box). Format: `lucene`; `template`:
   `https://web.archive.org/collection-search/gov/{searchTerms}` (placeholder
   in a path segment, percent-encoded — OpenSearch templates aren't limited
   to query strings).
4. **A few generic plain HTML search forms**, each demonstrating one Fields
   configuration mode: no Fields declared (plain-rewording Suggestions
   only, no fielded reformulation), a free-form text description, an
   inline JSON schema, and a
   custom `.format` render function.

## Implementation defaults (not separately grilled — flagging, not asking)

- **Accessibility**: standard ARIA combobox-with-listbox-popup pattern
  (arrow keys to move through suggestions, Enter to Accept, Escape to
  dismiss) — established practice, not a real fork.
- **Testing**: mock `window.LanguageModel` for unit tests; a small
  Playwright/real-Chrome suite for end-to-end checks against the demo.
- **Stack**: TypeScript source, vanilla Custom Elements (no Lit/framework
  runtime dependency), Shadow DOM with CSS custom properties + `::part()`
  for host theming, built to an ESM npm package (`query-shaper` — confirmed
  available) plus a CDN-servable bundle.
