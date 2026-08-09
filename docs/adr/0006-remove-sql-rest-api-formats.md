---
status: accepted
---

# Remove `sql` and `rest-api` Format support; keep `<query-shaper>` search-only

`<query-shaper>` shipped five Format presets: three that render field/value
tuples for search-style backends (`lucene`, `url-params`,
`simple-query-string`), plus two that shaped the whole component around a
different kind of backend entirely — `sql` (the model authors a complete
DuckDB SQL statement verbatim, no tuple decomposition) and `rest-api` (the
model additionally selects a REST endpoint and fills path parameters, on
top of the usual tuple rendering).

Those two pulled real complexity into the shared parts of the component
that every Format had to coexist with, whether or not they used it:

- A third `Fields` shape (`Record<string, FieldDescriptor[]>`, Resource-keyed)
  existed solely to describe multi-table/multi-endpoint backends — never
  meaningful for `lucene`/`url-params`/`simple-query-string`.
- A `resource` attribute, a table/file classification heuristic
  (`describeResources`/`isFileResource`), REST path-parameter substitution
  (`#renderRestUrl`/`#joinUrl`), and a `resource` property on `Suggestion`
  — all dead weight for a search-only consumer.
- The generation response schema branched on `this.format === 'sql'` to
  decide whether `text` was required, and always carried a `resource`
  property that only one Format ever populated.
- The domain vocabulary (`CONTEXT.md`) had to stretch "Resource" to cover
  both SQL tables/files and REST endpoints simultaneously, and "Format"'s
  definition had to explain three fundamentally different response
  strategies (render tuples ourselves / render tuples plus pick an
  endpoint / let the model author raw text) in one paragraph.

None of that was wrong when it was built — SQL and REST-API Expression
support were each deliberately, carefully designed (see the original
tickets, GitLab #7 and #8) — but living inside a component whose other
three Formats are all "search box that suggests field/value refinements"
meant every shared piece of the prompt, schema, and vocabulary had to keep
three genuinely different backend shapes simultaneously in mind. That
showed up concretely as prompt instructions competing for space and
attention against unrelated suggestion kinds, and as a system prompt that
could never be as sharply worded for any one backend shape as a
purpose-built one could be.

## Decision

Remove `sql` and `rest-api` Format presets, the `resource` attribute, the
Resource-keyed `Fields` shape, and all SQL/REST-specific rendering and
prompt-building code from `<query-shaper>`. The component keeps exactly
three Format presets, all of which render field/value tuples for search
backends: `lucene`, `url-params`, `simple-query-string`, plus the
`.format` custom-render-function escape hatch.

`base` and the `url-params`+`base` full-URL composition it enables are
**kept** — `base` was originally introduced alongside `rest-api` (GitLab
#8 bundled them together), but it is used today by `url-params` on its own
merits (composing a full URL instead of a bare query string for
facet-driven backends), independent of any endpoint-selection behavior
`rest-api` added on top. `output`/`none` Actions and the `destination`
attribute are also kept unaffected — they shipped independently (GitLab
#6, before either SQL or REST-API support existed) and apply to any
Format, not just the two being removed.

Before removal, two comprehensive handoff documents were written
(`/tmp/query-shaper-sql-handoff.md`, `/tmp/query-shaper-rest-handoff.md`)
capturing the full domain vocabulary, spec prose, implementation code,
test suite, and original commissioning tickets for each — intended to
bootstrap independent, purpose-built web components for each use case
later, unconstrained by having to coexist with a shared search-suggestion
schema.

## Considered Options

- **Keep both, accept the complexity.** Rejected — the whole motivation was
  crisper, more focused prompts and a simpler shared codebase; keeping
  everything in one component is exactly what produces the problem being
  solved here.
- **Keep the code but gate it behind an opt-in flag.** Rejected — dead code
  not exercised by default still has to be maintained, still complicates
  the response schema and system prompt for every consumer (the schema is
  the same for every instance on a page, not configurable per-instance),
  and doesn't actually buy the "crisper, format-specific prompts" goal this
  removal is for.
- **Remove without handoff documentation.** Rejected — SQL and REST-API
  Expression support represent real, deliberate design work (multi-Resource
  Fields, path-parameter substitution, table/file classification) that
  would otherwise have to be re-derived from git history alone if either
  becomes its own component later.

## Consequences

- `Fields` narrows to `string | FieldDescriptor[]` — no more Resource-keyed
  object form.
- The generation response schema drops the `resource` property and the
  `isSql`-branched `required` array — every Expression now just requires
  `kind`, same as every other Suggestion kind.
- `CONTEXT.md`'s **Resource** term is removed entirely; **Format** and
  **Fields** are rewritten without the SQL/REST clauses; **Base** is
  narrowed to describe only its `url-params` role.
- The demo page loses its REST-API (Ask Me Twice) and SQL (DuckDB over a
  remote Parquet file) instances; the production bundle shrank from 20.85 kB
  to 17.55 kB (unminified) as a direct result of the code removed.
- Reviving either use case means starting from the two handoff documents,
  not from this repo's `git log` — they're written to stand alone.
