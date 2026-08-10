---
status: accepted
---

# Destroy in-flight child sessions proactively; don't rely on `AbortSignal` alone

[ADR-0004](./0004-grandparent-parent-child-session-hierarchy.md) already
`destroy()`s a per-query "child" session in a `finally`, regardless of
outcome — but the design built on top of that (and closed issue #10, point
3) additionally assumed that calling `AbortSignal.abort()` on a superseded
call's `prompt()` was sufficient *on its own* to stop the on-device engine
from spending further compute on a result that was about to be discarded
anyway. That assumption was never independently tested; it was reasonable
to expect from the API shape, but wrong.

Real usage surfaced severe generation backlogs — typing continued to feel
"stuck," sometimes for tens of seconds to over a minute, well after the
visible Search Text had stabilized, with results eventually arriving in a
burst once the user had already moved on to a different field. Two rounds
of live diagnostics (minimal console scripts run directly against Chrome's
real on-device API, independent of `<query-shaper>` itself) isolated the
cause: `AbortSignal.abort()` alone does **not** reliably free the shared
engine for the next call. The aborted computation keeps running to
completion regardless of the signal — confirmed starkly under same-parent
load (the realistic case, since every query within one `<query-shaper>`
instance clones from the same parent): a superseded call's own settlement
and a freshly-fired sibling's resolution landed within milliseconds of each
other, the signature of a serially-busy engine rather than two independent
calls. `destroy()`, by contrast, reliably and quickly causes a pending
`prompt()` to reject — confirmed even when no `AbortSignal` was ever
attached to that call at all.

## Decision

Destroy the previous in-flight child's session **immediately** at the
moment it's superseded by a newer generation, or the moment the Search Text
is cleared — not merely `abort()`ed, and not deferred to that call's own
eventual `finally` (which never runs while the call is still pending). One
field, `#currentChild`, tracks whichever child is currently in flight;
`#destroyCurrentChild(expected?)` centralizes the destroy so the proactive
path and the original call's own `finally` can't double-destroy or
mistakenly destroy a newer child that has already superseded the one they
each think they're cleaning up.

Blur is handled differently: destroying immediately on blur risks
discarding good in-flight work if the user only briefly tabs away and
refocuses without retyping (`#onFocus` doesn't itself retrigger
generation, so there'd be nothing to replace what was destroyed). Instead,
blurring with a generation still in flight schedules a destroy after a
short grace period (`BLUR_DESTROY_DELAY_MS`, 3000ms — an empirical starting
point, same footing as `DEBOUNCE_MS`), canceled if the Target is refocused
before it elapses. A blur-triggered destroy bumps `#generationId` first, so
the `AbortError` it produces lands on a now-stale id and is silently
suppressed by `#generate()`'s existing supersede-handling, the same way any
other superseded call's error already is, rather than surfacing as a
spurious `query-shaper-error`.

## Considered Options

- **Rely on `AbortSignal.abort()` alone.** The original design (and issue
  #10's fix at the time). Rejected — disproven by live diagnostics; the
  engine doesn't actually stop working on the aborted call.
- **Destroy immediately on blur too, for symmetry with supersede/clear.**
  Rejected — a brief tab-away-and-back is a common, harmless interaction
  pattern; discarding perfectly good in-flight work for it has no upside,
  unlike supersede (a replacement is already starting) or clear (nothing is
  wanted at all).
- **Tune the debounce delay instead.** Rejected — a longer debounce reduces
  how *often* a call gets superseded but does nothing about the underlying
  same-parent serialization once it happens, and directly hurts
  responsiveness for anyone typing at a normal pace.

## Consequences

- `#generateInner`'s "search text cleared" and "superseded by a newer
  generation" paths both call `#destroyCurrentChild()` right after their
  existing `abort()` call.
- A new `#onBlur`/`#onFocus` pair: blur schedules a grace-period destroy
  (only if a child is actually in flight); focus clears any pending one.
- `disconnectedCallback` now also destroys any in-flight child, in addition
  to the instance ("parent") session it already destroyed.
- `SPEC.md`'s Generation flow no longer claims `abort()` alone stops engine
  compute — corrected to describe the destroy-immediately/grace-period-on-
  blur policy above.
- This refines ADR-0004's child-disposal *timing* without superseding the
  hierarchy itself (grandparent/parent/child, and destroy-in-`finally` as a
  backstop, are unchanged) — it is exactly the kind of re-verification
  ADR-0004's own "Caveat" section anticipated ("worth re-verifying as the
  API, model, and hardware mature, not assumed to hold forever").
- A note was left on issue #10, which asserted the now-disproven
  abort-is-sufficient claim, pointing here.

## Caveat

Same caveat as ADR-0003/ADR-0004: tested against one device, one on-device
model, and Chrome's current, actively-evolving Prompt API implementation.
The specific timing signature observed (near-simultaneous settlement under
same-parent load) is strong evidence, not a guarantee that holds across all
hardware/model combinations — worth re-verifying again as the API matures.
