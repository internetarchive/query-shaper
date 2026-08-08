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
- Non-`GET` HTTP semantics for `format="rest-api"` — no request bodies, no
  other HTTP methods; it composes URLs for read/search endpoints only

## Element API

**`for`** (attribute, required): id of the Target — an `<input>` or
`<textarea>`.

**`fields`** (attribute or `.fields` property): Fields declaration. The
attribute value is JSON-parsed first; if that fails, treated as a free-form
description string (e.g. `"title, author, language:iso-639-1, date (allowed
patterns YYYY[-MM[-DD]]), categories (comma-separated list)"`). The parsed
JSON form is either an array of field descriptors (single Resource, the
common case) or, for backends with more than one Resource, an object keyed
by Resource name, each value its own array of field descriptors (e.g.
`{"books": [{"name":"title"}, {"name":"year"}], "categories": [{"name":"id"}, {"name":"name"}]}`).
There's no `"default"`/`"_"` wrapper for the single-Resource case — the bare
array stays the default, un-nested form. The `.fields` property always wins
when both are set. Absent entirely → only Correction, Completion, and
Expansion suggestions are generated; no Expression.

**`resource`** (attribute, optional): the table, file, table-valued
expression (e.g. `read_csv('data.csv')`), or REST API endpoint path that a
bare-array/free-text Fields declaration's columns/parameters belong to —
meaningful for `format="sql"` and `format="rest-api"`. Ignored when `fields`
is the keyed-by-Resource object form, since the keys themselves supply this
per Resource. For `rest-api`, the value may contain `{name}`-style
path-parameter placeholders (e.g. `resource="questions/{slug}"`) — see
"REST-API prompt building" below.

**`base`** (attribute, optional): the root URL that `format="rest-api"`
composes a chosen Resource's path and query parameters onto, and that
`format="url-params"` optionally composes a full URL onto instead of
rendering a bare query string (see the `url-params` and `rest-api` entries
below). Accepts a relative path, an absolute path, or an absolute URL —
resolved via `new URL(base, document.baseURI)`, so it behaves exactly like
any other relative URL resolution in the browser, no special-casing needed
for the three forms. Defaults, when absent, to the current document's URL
with the query string and fragment stripped (`new URL(document.baseURI)`
with `.search`/`.hash` cleared).

**`format`** (attribute): a built-in preset name telling query-shaper how an
Expression's rendered text is arrived at:

- `lucene` — `field:value` tokens, space-separated, boolean operators/grouping;
  a field/value pair with no `field` renders as a bare, unscoped term (Lucene
  itself allows mixing bare terms with fielded clauses in one query, e.g.
  `climate change title:"policy"`). A multi-word **fielded** value is always
  quoted (`title:"climate change"`) — query-shaper adds the quotes itself
  deterministically rather than relying on the model to remember to, since
  that's proven unreliable in practice; a bare multi-word term is left
  unquoted, since that's normal, unscoped search-box input.
- `simple-query-string` — the classic `+required -excluded "exact phrase"`
  prefix-operator style: `+` marks a term required, `-` marks one excluded,
  no prefix means optional/should-match, and quoted values are preserved as
  exact phrases. Matches Elasticsearch's `simple_query_string` query and
  MySQL's boolean full-text mode, and is what most people mean by
  "traditional web search syntax." Bare terms are the primary case here;
  field-scoped terms (`+title:foo`) are supported but secondary. Since
  quoting means "exact phrase" here — not just a fielded-value disambiguator
  like in `lucene` — a multi-word value is quoted whether bare or fielded,
  same deterministic rule as `lucene`. Either format leaves an
  already-quoted value (the model quoted it itself) alone rather than
  double-quoting it.
- `url-params` — field/value pairs rendered as URL query parameters. When a
  **`base`** attribute is set, the rendered text is the full URL (`base` +
  `?` + the query string) rather than a bare query string; when `base` is
  absent, behavior is unchanged from today (bare query string).
- `rest-api` — like `lucene`/`url-params`/`simple-query-string`, field/value
  pairs are rendered by query-shaper, not authored by the model. What's
  different: the model additionally selects which declared Resource (REST
  endpoint) the Expression targets, and may fill `{name}`-style path
  parameters embedded in that Resource's path from the same tuple set — see
  "REST-API prompt building" below. The rendered `text` is always a fully
  composed absolute URL: **`base`** + the selected Resource's path (with any
  path parameters substituted) + `?` + the remaining tuples rendered as a
  query string (the same rendering `url-params` uses). If the model returns
  no Resource, `base` alone is the endpoint.
- `sql` — no field/value decomposition at all; the model authors the
  complete, runnable SQL statement directly (DuckDB dialect), including its
  own `FROM`/`JOIN` clauses, and query-shaper uses that text verbatim. Field
  filters, joins, projections, `ORDER BY`/`LIMIT`, and nested queries don't
  fit a flat field/value/operator shape, so unlike the other three presets,
  there's no rendering step to bypass — see "SQL prompt building" below for
  how Fields/Resource feed the prompt instead.
- Imperative-only escape hatch: a `.format` property accepting a custom render
  function, for shapes neither preset covers. Since it's a function over
  `FieldValue[]`, it can only ever operate on decomposed tuples — there's no
  way for a custom function to receive raw model-authored text the way `sql`
  does; a host wanting SQL-like freedom must use the `sql` preset itself.

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

**`max-suggestions`** (attribute): global cap on total suggestions shown
across all kinds combined. Sensible built-in per-kind defaults apply
underneath (e.g. up to 3 Expression / 2 Expansion / 2 Completion / 1
Correction); this attribute only trims the total, it doesn't expose
per-kind knobs yet.

**`max-history`** (attribute): cap on stored History entries, and on how many
are fed back into generation as context. `0` disables History — turns off
recording, stops using it as context, **and clears any existing entries**
already stored under this instance's key.

**`history-key`** (attribute, optional): overrides the localStorage
partition key for History. Defaults to the Target's `id` (always available,
since `for` requires one) — set this only when multiple instances should
deliberately _share_ one History.

Each stored entry is `{ searchText, suggestion, kind, timestamp }` — the
*original* Search Text, the Suggestion text that was Accepted for it, that
Suggestion's `kind`, and a `timestamp` (epoch ms) kept for debugging only,
never fed into a prompt. For a plain form submit with no Suggestion
involved, `searchText` and `suggestion` are the same value and `kind` is
`"submit"`. Storing the pairing, not just the final text, is what makes
History function as few-shot context rather than a flat log: the model can
see both what the user meant (the original text) and what kind of answer,
in what shape, has worked for them recently — not merely a list of past
queries with no signal about which parts of them were actually useful.

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
  exceeded, unrecoverable context overflow), or a `format="rest-api"`
  Expression was dropped because a Resource path's `{name}` placeholder
  couldn't be filled from the model's returned tuples (`phase:
  "rest-path-substitution"`). `detail: { error, phase }`. The Target itself
  never breaks — this is purely an observability seam.

### Suggestion shape

```ts
type Suggestion =
  | { kind: "correction"; text: string }
  | { kind: "completion"; text: string }
  | { kind: "expansion"; text: string }
  | {
      kind: "expression";
      text: string; // rendered per Format, or model-authored verbatim for sql
      fields?: Array<{ field?: string; value: string; operator?: string }>;
      resource?: string; // the Resource (REST endpoint) selected, rest-api only
    };
```

An entry with no `field` is a bare, unscoped term rather than a field
filter — the primary case for `simple-query-string`, a secondary one for
`lucene`. `operator`'s meaning is Format-specific: `AND`/`OR` for `lucene`,
`+`/`-` for `simple-query-string`.

`fields` is omitted entirely (not an empty array — an empty array would
falsely imply a query with zero conditions) for `format="sql"` Expressions,
since there's no decomposition step for them to report. This is also why
`fields` is optional on the type at all: every other Suggestion kind, and
every other Format, always populates it.

`resource` is populated only for `format="rest-api"` Expressions where the
model determined which declared endpoint applies — e.g. Fields declared as
a Resource-keyed object (multiple candidate endpoints), or free-form text
describing endpoints in prose. It's omitted when a `resource` attribute
already pins a single fixed endpoint, since there's nothing left to
disambiguate, and omitted for every non-`rest-api` Format, same as `fields`
is for `sql`.

Every Suggestion the model returns already has typo corrections folded into
its basis text (an Expression never faithfully encodes a typo the model
also flagged as a Correction) — see the unified-generation note below.

### SQL prompt building

When `format="sql"`, the "Available fields" prompt section is replaced with
a schema-like listing instead of a bare field list, and each Resource is
described as a table or a file:

- A Resource name is classified as a **file** if it contains `(` `)` (a
  function-call shape, e.g. `read_csv(...)`), is a quoted string literal, or
  contains a recognizable file extension, URL scheme, or `/` path separator.
  Everything else defaults to **table** — the common case, and safer than
  guessing "file" from an unrecognized shape.
- The prompt groups Resources by that classification and explicitly tells
  the model to write SQL for DuckDB, which can query local or remote files
  directly:

  ```
  Available tables:
  - books(title, year, author, category_id)

  Available files (DuckDB can query these directly — local or remote):
  - read_csv('data.csv')(title, year)

  Write SQL for DuckDB.
  ```

- Multi-table joins are the model's call to make, not query-shaper's — if it
  determines a question needs `books` and `categories` together, it writes
  the `JOIN` itself. query-shaper has no notion of foreign-key relationships
  and doesn't attempt to construct or validate joins; the model's returned
  `text` is used verbatim regardless of how many Resources it drew on, since
  that's already embedded in the SQL text's own `FROM`/`JOIN` clauses.
- A bare-array/free-text Fields declaration (single Resource) uses the
  `resource` attribute for the same table/file classification, phrased the
  same way. If `resource` is also absent, no schema listing is added — the
  free-form Fields text (if any) is passed through as-is, same as every
  other Format, and the model is left to infer table/file naming itself.

### REST-API prompt building

When `format="rest-api"`, Fields describes one or more REST endpoints
(Resources), and the prompt always explains the path-parameter convention
below regardless of which Fields shape is in play:

- A **Resource-keyed Fields object** lists multiple endpoints by path (e.g.
  `{"questions": [...], "questions/{slug}": [...], "responses": [...]}`),
  each with its own field descriptors — the model must pick one per
  Expression and return it as `resource` on the Suggestion.
- A **bare array + `resource` attribute** declares a single, fixed endpoint;
  the model is never asked to choose or return one, since there's only one.
- **Free-form text** Fields describes available endpoints in prose; the
  model must both infer and return a `resource` string, same as it infers
  field names from prose under any other Format.

**Path parameters**, in every shape above, use one convention: an endpoint
path may contain `{name}` placeholders (e.g. `questions/{slug}`). The model
fills these from the *same* field/value tuple set it already returns for
query parameters — no separate `in: "query" | "path"` marker on field
descriptors. Rendering:

1. Take the Resource path — from the `resource` attribute, or the model's
   returned `resource`, or `base` alone if neither is present.
2. For each `{name}` token in that path, find a returned tuple whose `field`
   matches `name`, percent-encode its `value` with `encodeURIComponent`
   (same encoding the `opensearch` Action already uses for `{searchTerms}`
   substitution — not `URLSearchParams`'s `+`-for-space rule), and splice it
   in. Consumed tuples are removed from the set.
3. Render whatever tuples remain as a query string (the same renderer
   `url-params` uses) and append it to `base` + the substituted path.

query-shaper does not validate a model-returned `resource` against the
declared endpoint list — it's trusted verbatim, the same trust the `sql`
preset already extends to raw model-authored text. If, after step 2, the
path still contains an unresolved `{name}` token, the Expression Suggestion
is dropped and `query-shaper-error` fires with `phase:
"rest-path-substitution"` instead of emitting a structurally broken URL.

## Generation flow

1. **First focus** on the Target: call `LanguageModel.availability()`.
   - `unavailable` → do nothing; fully inert, standard input behavior.
   - `available` → establish this instance's session per the grandparent/
     parent/child hierarchy (ADR-0004): the page-wide shared "grandparent"
     base session is created once (seeded with a generic, Fields-agnostic
     system instruction via `initialPrompts`); this instance's "parent" is
     `clone()`d from it and primed once with this instance's Fields/Format
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
   empirical tuning against real model latency): if Fields/Format changed
   imperatively since the parent was primed, rebuild it first (destroy the
   stale one, clone fresh from the grandparent, re-`append()`). Then clone a
   disposable "child" from the parent and build **one** prompt call — now
   just History (most recent entries up to `max-history`) and the current
   Search Text, since the generic instruction and Fields/Format both live
   upstream in the grandparent/parent already. Use `responseConstraint` with
   a JSON Schema requiring an array of Suggestion objects, already tagged by
   kind and pre-sorted by the model. No staged/sequential correction-first
   pass — one call, one response, avoiding both the latency and the
   response-merging complexity a staged pipeline would add. The child is
   `destroy()`ed once the call settles (success, failure, or abort) — it
   only ever exists for this one query.

   The schema alone doesn't reliably get the model to produce more than one
   Suggestion — the (now upstream, grandparent-level) instruction explicitly
   spells out the per-kind caps ("up to 1 correction... up to 2
   completions... up to 2 expansions... up to 3 expressions... as its own
   separate item") and instructs it never to invent extra properties. The schema itself sets `additionalProperties:
   false` at every object level, since the model has been observed inventing
   sibling properties (e.g. a `fields_expanded` next to `fields`) to smuggle
   in content it didn't fit into the declared shape, which then gets
   silently dropped.

   If the model still returns an Expression with no `fields` at all under a
   tuple-rendering Format (`lucene`/`simple-query-string`/`url-params`/
   `rest-api`) but does provide `text`, that `text` is used verbatim as a
   fallback rather than rendering an empty, invisible Suggestion from an
   empty tuple set. This is a deliberate tradeoff, not an oversight: unlike
   `sql`, these Formats are meant to guarantee code-rendered, correct
   syntax, and this fallback path forfeits that guarantee — the model can
   write syntactically wrong text here (e.g. `year=2020` instead of
   `year:2020` for `lucene`), unvalidated and uncorrected. Showing it
   anyway was chosen over dropping it, on the view that a possibly-flawed
   Suggestion beats silently offering fewer than the model attempted.

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

   A Suggestion whose rendered `text` is identical (after trimming) to the
   current Search Text is dropped before rendering — every Suggestion is
   meant to be a better alternate, and echoing the input back verbatim
   isn't one, regardless of kind.
3. **Render**: grouped by kind (Correction / Completion / Expansion /
   Expression), up to `max-suggestions` total — unless `headless`, in which
   case only `query-shaper-suggestions` fires.
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
   (before touching Fields/Format/Search Text) and retry, rather than
   surfacing an error for something the user configured a number for.
7. **Transient model errors**: a `responseConstraint` call can fail with a
   generic `UnknownError` that isn't tied to any specific schema shape —
   observed to be intermittent (the same schema succeeds on one call and
   fails on the next), consistent with Chrome's on-device model still being
   actively developed. Retried up to twice before giving up.
8. **Any other failure**: emit `query-shaper-error`; that generation cycle
   simply shows no suggestions; the Target keeps working as a plain input.

## Demo plan

A single demo page with multiple `<query-shaper>` instances. `Accept`
produces something directly usable against that instance's real backend —
navigating to a results page for four of them, and displaying/linking to a
constructed REST URL for the fifth (Ask Me Twice, a JSON API with no results
page of its own and no CORS support) — no inline result-fetching in any
case.

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
   configuration mode: no Fields declared (Correction/Completion/
   Expansion-only fallback), a free-form text description, an inline JSON
   schema, and a
   custom `.format` render function.
5. **Ask Me Twice** (`wayback-api.archive.org/services/amt-api`, archive.org's
   internal AI-response-tracking API) — confirmed live, GET-only. Its data
   endpoints do send `Access-Control-Allow-Origin: *` (confirmed with an
   `Origin` header on the request — a plain request without one won't show
   it, which is normal CORS behavior, not a sign it's absent), so inline
   fetching is technically possible; the demo still doesn't do it, for the
   same reason the other four don't — Accept produces something to act on,
   not a rendered result. `base`:
   `https://wayback-api.archive.org/services/amt-api/api/v1`; Fields as a
   Resource-keyed object with two endpoints: `responses` (`provider`,
   `model_id`, `question_slug`, `day`, `error_type` — real, confirmed query
   parameters on the live list endpoint) and `questions/{slug}` (a single
   `slug` field, demonstrating path-parameter substitution; the model's
   guessed slug is trusted, not validated, same as every other `rest-api`
   Resource). Format: `rest-api`. Action: `output` with an explicit
   `destination`, which the demo page's own script turns into a clickable
   link (the URL is both the link text and its `href` — one element, not a
   separate link alongside a plain-text display) on `query-shaper-accept`.

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
