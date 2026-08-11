---
status: accepted
---

# Publish to npm on GitHub Release, via OIDC Trusted Publishing, as `@internetarchive/query-shaper`

Grilled directly (`/grill-with-docs`) rather than flagged, since every
sub-decision here is genuinely hard to reverse, non-obvious, or the
result of a real tradeoff — the three criteria this repo's ADRs are
reserved for.

## Decision

- **Auth**: npm's OIDC Trusted Publishing. No `NPM_TOKEN` (or any
  other long-lived credential) is stored as a repo secret.
- **Namespace**: scoped, `@internetarchive/query-shaper` — not the
  unscoped `query-shaper` (confirmed available at decision time).
- **Versioning**: manual. A human bumps `package.json`'s `version` in a
  commit, then cuts a matching GitHub Release (tag `vX.Y.Z`). CI
  verifies the tag matches `package.json`'s version and fails loudly on
  mismatch — it never derives or rewrites the version itself.
- **Dist-tag**: a GitHub Release marked pre-release publishes to npm's
  `next` tag; a real Release publishes to `latest`.
- **Trigger**: `on: release: types: [published]` — one publish per
  GitHub Release, not per push or per tag.

## Considered Options

- **Auth — OIDC Trusted Publishing (chosen) vs. a classic `NPM_TOKEN`
  secret.** Trusted Publishing means nothing capable of publishing this
  package sits in the repo at rest — no secret to rotate, leak, or
  scope too broadly. The real cost: npm has no way to configure a
  trusted publisher for a package that doesn't exist yet (confirmed —
  see "Consequences"), so a classic token remains necessary for exactly
  one act, the first publish. A token-only design would have avoided
  that one-time asymmetry, but would leave a standing credential in the
  repo for every release after, which is the worse trade for a project
  expected to keep publishing indefinitely.
- **Namespace — scoped `@internetarchive/query-shaper` (chosen) vs.
  unscoped `query-shaper`.** Both were free to claim at decision time,
  so there was no migration cost to weigh either way *yet* — but npm
  has no rename/alias mechanism at all: moving between the two later
  means publishing a second, separate package from scratch and running
  `npm deprecate` on the first, with every existing consumer having to
  switch by hand. Given the `internetarchive` org already exists on
  npm with prior published packages, and the GitHub repo itself already
  lives at `internetarchive/query-shaper`, scoping now avoids ever
  needing that migration.
- **Versioning — manual bump-then-tag (chosen) vs. CI deriving the
  version from the release tag vs. full automated versioning
  (changesets/semantic-release).** CI-derives-from-tag saves one commit
  per release, but lets `main`'s checked-in `package.json` version
  silently drift from what's actually live on npm — a confusing split
  source of truth. Automated versioning is real tooling investment
  aimed at multi-contributor, high-release-frequency projects; this one
  is pre-1.0 and single-maintainer, and every other part of it (commits,
  ADRs, retroactive tickets) is already deliberate and manual by
  established convention — matching that, with an explicit CI check
  standing in for the discipline, was the more consistent choice.
- **Dist-tag — branch on the Release's `prerelease` flag (chosen) vs.
  always publishing to `latest`.** Always-`latest` is simpler, but
  README already frames the project as "Early development, pre-release"
  — a plain `npm install` handing someone an unstable build during that
  period is exactly the failure mode a `next` tag exists to prevent, at
  the cost of one ternary in the workflow.

## Consequences

- **The bootstrap gap is real and unavoidable.** Confirmed against
  npm's own documentation and `npm/cli#8544` (open, unresolved at
  decision time): a trusted publisher can only be configured from an
  existing package's settings page, so the very first publish of
  `@internetarchive/query-shaper` must happen from an authenticated
  human's machine (`npm login` + `npm publish --access public`), not
  from CI. Every release after that is fully automated by
  `.github/workflows/publish-npm.yml`.
- `package.json` carries `"publishConfig": { "access": "public" }` —
  required because scoped packages default to restricted/private on
  npm; without it, both the manual bootstrap publish and every CI
  publish after it would need to remember `--access public` explicitly
  or risk silently publishing a private package no one can install.
- The Trusted Publisher configuration on npmjs.com is tied to this
  exact repo, the exact workflow filename (`publish-npm.yml`), and a
  dedicated GitHub Environment (`npm-publish`) that the workflow
  references — renaming the workflow file, or moving the job out of
  that environment, breaks the trust relationship and needs
  re-configuring on npmjs.com by hand.
- If `@internetarchive/query-shaper` is ever deprecated in favor of a
  different namespace (or vice versa), there is no registry-level
  redirect — see the Namespace option above. Any such move is a new
  package, a `npm deprecate` on this one, and a docs update pointing
  existing consumers at the replacement.
