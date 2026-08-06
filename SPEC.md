# Query Shaper — Spec

Synthesizes the design session recorded in `CONTEXT.md` (vocabulary) and
`docs/adr/` (the two hardest-to-reverse calls) into something implementable.

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

**`for`** (attribute, required): id of the Target.

**`fields`** (attribute or `.fields` property): Fields declaration. The
attribute value is JSON-parsed first; if that fails, treated as a free-form
description string (e.g. `"title, author, language:iso-639-1, date (allowed
patterns YYYY[-MM[-DD]]), categories (comma-separated list)"`). The `.fields`
property always wins when both are set. Absent entirely → only Correction and
Expansion suggestions are generated; no Expression.

**`format`** (attribute): a built-in preset name telling query-shaper how to
render an Expression's field/value pairs into the backend's real query
output:

- `lucene` — `field:value` tokens, space-separated, boolean operators/grouping;
  a field/value pair with no `field` renders as a bare, unscoped term (Lucene
  itself allows mixing bare terms with fielded clauses in one query, e.g.
  `climate change title:"policy"`).
- `simple-query-string` — the classic `+required -excluded "exact phrase"`
  prefix-operator style: `+` marks a term required, `-` marks one excluded,
  no prefix means optional/should-match, and quoted values are preserved as
  exact phrases. Matches Elasticsearch's `simple_query_string` query and
  MySQL's boolean full-text mode, and is what most people mean by
  "traditional web search syntax." Bare terms are the primary case here;
  field-scoped terms (`+title:foo`) are supported but secondary.
- `url-params` — field/value pairs rendered as URL query parameters.
- Imperative-only escape hatch: a `.format` property accepting a custom render
  function, for shapes neither preset covers.

**`action`** (attribute): one of `fill` (default), `submit`, `opensearch`.
`opensearch` requires a **`template`** attribute/property holding a
`{searchTerms}`-style URL template (placeholder may appear in a path segment,
not just a query string — see the Wayback example below).

**`max-suggestions`** (attribute): global cap on total suggestions shown
across all kinds combined. Sensible built-in per-kind defaults apply
underneath (e.g. up to 3 Expression / 2 Expansion / 1 Correction); this
attribute only trims the total, it doesn't expose per-kind knobs yet.

**`max-history`** (attribute): cap on stored History entries, and on how many
are fed back into generation as context. `0` disables History — turns off
recording, stops using it as context, **and clears any existing entries**
already stored under this instance's key.

**`history-key`** (attribute, optional): overrides the localStorage
partition key for History. Defaults to the Target's `id` (always available,
since `for` requires one) — set this only when multiple instances should
deliberately _share_ one History.

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
type Suggestion =
  | { kind: "correction"; text: string }
  | { kind: "expansion"; text: string }
  | {
      kind: "expression";
      text: string; // rendered, per the configured Format
      fields: Array<{ field?: string; value: string; operator?: string }>;
    };
```

An entry with no `field` is a bare, unscoped term rather than a field
filter — the primary case for `simple-query-string`, a secondary one for
`lucene`. `operator`'s meaning is Format-specific: `AND`/`OR` for `lucene`,
`+`/`-` for `simple-query-string`.

Every Suggestion the model returns already has typo corrections folded into
its basis text (an Expression never faithfully encodes a typo the model
also flagged as a Correction) — see the unified-generation note below.

## Generation flow

1. **First focus** on the Target: call `LanguageModel.availability()`.
   - `unavailable` → do nothing; fully inert, standard input behavior.
   - `available` → create (or, per ADR-0002, `clone()` from the page's shared
     base) a session; reuse it for this instance going forward.
   - `downloadable` → (unless `headless`) show an unobtrusive inline message
     inviting the user to enable client-side search enhancement, with a
     button to trigger the download and a dismiss option. Dismissal is
     remembered in localStorage (origin-scoped) so it doesn't reappear.
2. **Debounced input** (~400ms pause — a starting point, expected to need
   empirical tuning against real model latency): build **one** prompt call
   combining Fields, Format instructions, History (most recent entries up to
   `max-history`), and the current Search Text. Use `responseConstraint` with
   a JSON Schema requiring an array of Suggestion objects, already tagged by
   kind and pre-sorted by the model. No staged/sequential correction-first
   pass — one call, one response, avoiding both the latency and the
   response-merging complexity a staged pipeline would add.
3. **Render**: grouped by kind (Correction / Expansion / Expression),
   up to `max-suggestions` total — unless `headless`, in which case only
   `query-shaper-suggestions` fires.
4. **Accept**: apply `action` (fill the Target / submit its form / navigate
   via the `opensearch` template); emit `query-shaper-accept`; record a
   History entry.
5. **History finalization triggers** (deduped so one user action never logs
   twice): a native form submit fires: record current Search Text. A
   Suggestion is Accepted with `action="fill"` (no submit follows): record
   it. An `opensearch` Action is invoked (navigation): record it.
6. **Context overflow**: if the combined prompt risks exceeding the model's
   context window, proactively trim the _oldest_ History entries first
   (before touching Fields/Format/Search Text) and retry, rather than
   surfacing an error for something the user configured a number for.
7. **Any other failure**: emit `query-shaper-error`; that generation cycle
   simply shows no suggestions; the Target keeps working as a plain input.

## Demo plan

A single demo page with multiple `<query-shaper>` instances, each `Accept`
navigating to the backend's real results page (no CORS dependency, no inline
result-fetching):

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
   Field an Expression varies — collections have their own namespaced
   pages today, not a single unified search box). Format: `lucene`; `template`:
   `https://web.archive.org/collection-search/gov/{searchTerms}` (placeholder
   in a path segment, percent-encoded — OpenSearch templates aren't limited
   to query strings).
4. **A few generic plain HTML search forms**, each demonstrating one Fields
   configuration mode: no Fields declared (Correction/Expansion-only
   fallback), a free-form text description, an inline JSON schema, and a
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
