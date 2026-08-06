---
status: accepted
---

# Shared base LanguageModel session, cloned per instance

A page can host multiple `<query-shaper>` instances at once (the demo page
alone has four-plus, each pointed at a different backend). Rather than each
instance creating its own independent `LanguageModel` session, the first
instance to focus creates one shared base session, and every instance
(including that first one) works from a `session.clone()` of it. This avoids
redundant model loads and memory overhead when several instances coexist,
while `clone()` still gives each instance its own isolated prompt/context —
one instance's Fields, Syntax, and History never leak into another's.

## Consequence

Session lifecycle is now a page-wide concern, not purely a per-instance one:
the base session must outlive any single instance's clone, and instance
teardown must `destroy()` only its own clone, never the shared base.
