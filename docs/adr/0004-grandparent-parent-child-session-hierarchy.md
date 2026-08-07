---
status: accepted
---

# Grandparent/parent/child session hierarchy for Fields/Format priming and per-query isolation

[ADR-0002](./0002-shared-base-session-with-per-instance-clones.md) established
one shared base session, cloned per `<query-shaper>` instance, reused for that
instance's entire lifetime. [ADR-0003](./0003-resend-fields-per-prompt-not-primed.md)
then found two problems with that reuse, empirically:

1. Resending Fields/Format on every prompt is the *only* reliable option
   among the two tried at the time — `append()`'d content doesn't survive
   context-window pressure, and priming via `initialPrompts` requires an
   independent, non-cloned `create()` per instance, which carries a real,
   idle-sensitive cost (measured up to 13–14 seconds) landing right at
   session establishment.
2. Separately (raised independently of ADR-0003): reusing one clone for an
   instance's entire lifetime means the session's *own* internal conversation
   history grows unboundedly across every debounced query that instance ever
   makes — redundant with the curated `History` already built and sent
   explicitly, and not something the existing `QuotaExceededError`-triggered
   retry (which only trims that explicit `History`, not the session's own
   accumulated turns) actually addresses.

A three-tier hierarchy resolves both, by noticing *why* `append()`'d content
gets evicted: not because of its role, but because a session that keeps
receiving more `prompt()` turns eventually needs to trim older ones to make
room. A session that never receives any further turns after being primed is
never subject to that pressure at all.

- **Grandparent** — the shared base session from ADR-0002, created once per
  page. Now also seeded with a generic, Fields-agnostic system instruction via
  `initialPrompts` at that one `create()` call — the one mechanism ADR-0003
  confirmed genuinely persists (survived 60 padding turns in testing).
- **Parent** — one per instance, `clone()`d from the grandparent on first
  focus. Primed once with that instance's Fields/Format description via
  `parent.append([{ role: 'user', content: ... }])`. Not `role: 'system'`:
  `append()` rejects a second system-role message once the grandparent's
  `initialPrompts` has already claimed the session's first-message slot.
  The parent is **never itself prompted again** — only ever cloned *from* —
  so ADR-0003's eviction risk never applies to it.
- **Child** — a fresh, disposable `clone()` of the parent, made for exactly
  one query: `prompt()`ed (internal retries for `QuotaExceededError`/
  `UnknownError` reuse the same child), then `destroy()`ed in a `finally`,
  regardless of outcome.

Every tier uses `clone()`, never an independent `create()`, so ADR-0003's
idle-sensitive cost never applies beyond the one page-wide grandparent.
`clone()` itself measured at 0.1–3.9ms regardless of idle time, as long as
the ancestor being cloned stays alive.

## Empirical validation

Tested live against the real on-device model before implementing:

- A clone of a clone correctly inherits *both* the grandparent's
  `initialPrompts` and the parent's `append()`'d content.
- Sibling isolation holds: one child was prompted to "learn" a new fact
  about itself; a second child, cloned from the same parent immediately
  afterward, had no knowledge of it. One child's own conversation never
  leaks back into the parent, or forward into a fresh sibling.

## Consequences

- Per-query prompts now carry only History + Search Text — the generic
  instruction and Fields/Format both moved upstream, out of the per-query
  payload.
- `disconnectedCallback` destroys the parent, not a query-scoped session —
  nothing query-scoped outlives its own call in the first place.
- Fields/Format changing imperatively invalidates the current parent
  (destroy it, clone fresh from the grandparent, re-`append()`) rather than
  being detected as a difference in per-query prompt text, since that text
  no longer carries Fields/Format at all.

## Caveat

Same caveat as ADR-0003, still true here: tested against one device, one
on-device model, and Chrome's current, actively-evolving Prompt API
implementation — including the specific `append()` role constraint this
design leans on. Worth re-verifying as the API, model, and hardware mature,
not assumed to hold forever.
