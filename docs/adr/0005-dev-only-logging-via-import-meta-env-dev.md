---
status: accepted
---

# Dev-only logging via `import.meta.env.DEV`, verified stripped by Vite's tree-shaking

Debugging session lifecycle and generation timing (retries, aborts, latency,
suggestion counts) needed real visibility during development, but none of
it belongs in the published bundle — extra console noise for every consumer,
and internal implementation detail (prompt timing, retry counts, session
tiers) that isn't part of the public contract.

Two small helpers, `devLog(...)` and `devTimed(label, fn)`, wrap every log
call site in `if (import.meta.env.DEV)`. Vite statically replaces
`import.meta.env.DEV` at build time (`true` under `vite`/`vitest`, `false`
under `vite build`), and the resulting `if (false) { ... }` branches are
tree-shaken away entirely — not just left in as dead code that never runs.

## Verified, not assumed

Built with a temporary, uniquely-named marker behind the same guard, then:

- Confirmed present (and would execute — `import.meta.env.DEV` evaluates
  truthy in the browser) when served via `npm run dev`.
- Confirmed **zero** occurrences of the marker, `devLog`/`devTimed`, or even
  the literal string `import.meta.env` in `dist/query-shaper.js` after
  `npm run build` — with no `minify` option set in `vite.config.ts`. The
  stripping is Vite/Rollup's ordinary tree-shaking, not something that
  depends on minification being on.

This was checked directly against the actual build output rather than
assumed from how Vite's library-mode docs describe `import.meta.env`,
consistent with this project's general practice of verifying Prompt-API
and build-tooling behavior empirically before relying on it (see ADR-0003,
ADR-0004).

## Considered options

- **A runtime flag** (e.g. a `debug` attribute, or checking `localStorage`)
  — rejected: still ships the logging code (and its string literals) to
  every consumer, just gated off by default; doesn't reduce bundle size or
  keep internal debugging detail out of the published artifact.
- **`console.time()`/`console.timeEnd()` directly** for timing — rejected:
  labels are a shared global namespace in devtools. Multiple `<query-shaper>`
  instances, or an aborted-then-restarted generation on the same instance,
  can have overlapping in-flight timers; a collision produces a warning and
  a wrong duration. `devTimed` measures via `performance.now()` in a local
  closure instead, so concurrent timers never interfere with each other.
- **`import.meta.env.DEV` + tree-shaking** (chosen) — zero runtime cost and
  zero bundle-size cost in production, without needing a separate build
  target or a bundler plugin to strip debug code.

## Consequence

`tsconfig.json` needed `"vite/client"` added to `compilerOptions.types` —
`import.meta.env` doesn't type-check otherwise, since `tsc` (used here only
for `.d.ts` generation and the standalone `typecheck` script, not for
emitting the actual build) has no built-in knowledge of Vite's client env
types.
