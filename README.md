# Query Shaper

`<query-shaper>` is a web component you attach to a search input to turn a
natural-language query into something a search backend can actually use.

Instead of sending the raw text straight to your search index, Query Shaper
uses the browser's built-in, on-device AI (the kind now shipping in browsers
like Chrome) to understand the intent behind what someone typed and suggest:

- **Structured queries** — boolean/fielded query variants (e.g.
  `title:"climate change" AND year:2020..2023`) derived from the natural
  language input
- **Typo corrections** — likely misspellings caught and corrected before the
  search runs
- **Query expansions** — related terms, synonyms, and alternate phrasings
  that widen recall without the user having to think of them

The goal is more precise, more efficient searches, without asking users to
learn a query syntax — and without sending their queries to a server-side LLM.

## Why client-side AI

Because the language understanding happens on-device via the browser's
built-in AI APIs, query interpretation:

- Adds no server-side LLM cost or latency
- Doesn't send the user's raw search input to a third-party inference API
- Works as a progressive enhancement — the search input still works
  normally in browsers without built-in AI support

## Status

Early development, pre-release (`0.0.1`, unpublished). The core behavior
tracked in `SPEC.md` — Correction/Completion/Expansion/Expression
generation, the `lucene`/`url-params`/`simple-query-string` Formats,
Actions, History, the accessible popup UI, and the demo page — is
implemented; see `CONTEXT.md` for the vocabulary and `docs/adr/` for the
hardest-to-reverse architectural calls.

## Development

Requires Node.js and Chrome 138+ (for the built-in `LanguageModel` API used
at runtime; not required just to build or test).

```sh
npm install
npm run dev        # serves ./demo against the current source
npm test           # run the unit test suite
npm run typecheck
npm run lint
npm run build      # emits the npm package + CDN bundle to ./dist
```

Session lifecycle and generation timing are logged to the console
(prefixed `[query-shaper]`) whenever the component is loaded via `npm run
dev` — status transitions, session/parent establishment timing, per-query
`prompt()` timing, retries, aborts, and final Suggestion counts. This is
dev-only: it's gated on `import.meta.env.DEV`, which Vite replaces and
tree-shakes away entirely in `npm run build` — none of it ships in `dist/`.

## License

Query Shaper is licensed under the [GNU Affero General Public License v3.0](LICENSE).
