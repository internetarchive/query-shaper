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

Early development. The custom element, its attributes/events, and the
browser-AI integration are still being designed. This README describes the
intended shape of the project; expect it to evolve.

## License

Query Shaper is licensed under the [GNU Affero General Public License v3.0](LICENSE).
