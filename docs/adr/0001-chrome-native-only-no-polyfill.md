---
status: accepted
---

# Chrome-native only, no polyfill dependency

`<query-shaper>` uses Chrome's built-in `LanguageModel` API directly and ships
no fallback for browsers that lack it (Firefox, Safari, and non-desktop
Chromium today). An official `prompt-api-polyfill` package exists, but it can
fall back to a cloud LLM backend on unsupported browsers — enabling it by
default would silently break the project's core privacy claim (search text
never leaves the device) on any browser other than Chrome, in a way a host
integrating the component wouldn't necessarily notice. Unsupported browsers
get a fully inert element and behave exactly like a plain search input
(progressive enhancement), rather than a degraded privacy guarantee.

## Considered options

- **Ship the polyfill by default** — rejected: its cloud fallback path is an
  unconditional trade against the privacy story, not an opt-in one.
- **Chrome-native only** (chosen) — narrower reach today, but the privacy
  guarantee holds unconditionally across every browser the component runs in.

A future opt-in adapter for the polyfill (host explicitly requests it) remains
possible without revisiting this decision, since it wouldn't change the
default behavior.
