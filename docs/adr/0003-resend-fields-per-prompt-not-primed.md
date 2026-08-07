---
status: superseded by ADR-0004
---

# Resend Fields/Format per prompt, not primed via `initialPrompts`

Fields and Format instructions are the same on every prompt call for a given
instance, changing only if `.fields`/`.format` are set imperatively. Priming
a session with them once — instead of resending them on every debounced
call — looked like a clear latency win, so it was tested empirically against
the real on-device model rather than assumed.

Two mechanisms were tried:

- **`session.append()`** after `clone()`, with the Fields/Format description
  as either a `user`- or `system`-role message. Confirmed by test: content
  appended this way is silently dropped under context pressure — recall
  failed after enough padding turns, with no error thrown either time
  (`stoppedWith: null`), regardless of role. Chrome's documented "the system
  prompt is never removed" guarantee does not extend to `append()`; it's
  specific to the one message set via `initialPrompts` at a session's
  original `create()` call. A genuine `initialPrompts` system message, by
  contrast, survived 60 padding turns with correct recall intact.
- **`LanguageModel.create({ initialPrompts: [...] })`** directly, per
  instance, to get that real persistence guarantee. This requires giving up
  [ADR-0002](./0002-shared-base-session-with-per-instance-clones.md)'s
  shared-base-session-then-`clone()` pattern for any instance with Fields
  configured, since the protected system message is fixed once at a single
  session's creation and can't be added to a clone after the fact. Timed
  against `clone()` under otherwise-identical conditions, `clone()` stayed
  cheap (0.1–3.9ms) whether called immediately after another operation or
  after a deliberate 20-second idle gap. An independent `create()` did not:
  ~120ms immediately after another `create()`, ~679ms after 20 seconds idle,
  and 13–14 seconds after the longer, conversational-pace gaps between test
  rounds — a real, reproducible relationship between idle time and cost that
  `clone()` is simply immune to (it reuses the already-loaded base's
  resources rather than re-establishing anything).

Combining those two findings: there's no reliable way to prime Fields/Format
once and trust it to persist, and the one mechanism that *would* persist
carries a real risk of a multi-second stall landing at session
establishment — the single worst place for it, since that's exactly when a
user is waiting to see their first Suggestions.

## Considered options

- **`append()` once per instance/config change** (tried) — rejected: not
  reliably persistent, fails silently with no error to react to.
- **Independent `create({ initialPrompts })` per Fields-bearing instance**
  (tried) — rejected: reliably persistent, but trades ADR-0002's sharing
  benefit for an idle-sensitive session-establishment cost that can spike to
  double digits of seconds.
- **Resend Fields/Format in every prompt call** (current, kept) — slower
  per call in the steady state, but predictable, and doesn't risk a silent
  correctness regression or an unpredictable stall at the worst possible
  moment.

## Caveat

This was tested against one device, one on-device model, and Chrome's
current (still actively evolving) implementation of the Prompt API — the
in-page banner Chrome itself shows on this feature says as much. A more
capable device, a better-optimized model, or a more mature session/caching
implementation could change these numbers, possibly enough to flip the
conclusion. Worth re-testing rather than assuming this holds forever.
