# @wix/evalforge-core

Skill-agnostic core shared by this repo's EvalForge GitHub Actions. It holds the
parts of the EvalForge integration that don't depend on any particular action's
CLI surface or file layout:

- **`schema`** — the eval scenario schema (Zod) and `parseScenario`, which parses
  and validates a scenario YAML file into a typed `Scenario`.
- **`evalforge`** — the `EvalForgeClient` REST client for the EvalForge V1 API
  (`www.wixapis.com`), plus shared types (`RemoteScenario`, `ScenarioBody`,
  `RunStatus`, …) and helpers for managed tags and draft tags
  (`withManagedTags`, `draftTagFor`, `repoTagFor`, …).
- **`evalforge-mapper`** — `toEvalForgeBody`, which maps a parsed `Scenario` into
  the `EvalForgeBody` shape the V1 API expects (assertion links, bootstrap
  steps, site setup, etc).
- **`auth`** — `TokenProvider`, an OAuth2 client-credentials token provider for
  the Wix public API, with caching and re-mint-before-expiry so a long-running
  eval poll doesn't get caught mid-request with a stale token.

Everything is re-exported from `src/index.ts`.

## How it's consumed

This package is **not published to npm** (`package.json` sets `"private": true`).
Instead, `.github/actions/evalforge-yaml-gate` depends on it as a local
`portal:` dependency:

```json
"@wix/evalforge-core": "portal:../../../packages/evalforge-core"
```

and `ncc` inlines the built output into that action's committed
`dist/index.js` when the action is built. CI does not run `yarn install` or a
build step for the actions — it runs the committed bundle directly — so any
change to this package must be built, and the consuming action must be rebuilt
and its `dist` re-committed, before it takes effect in CI.

## Local commands

Run these via a subshell, not `yarn --cwd`:

```bash
(cd packages/evalforge-core && yarn build)
(cd packages/evalforge-core && yarn test)
```

**Why the subshell and not `yarn --cwd packages/evalforge-core build`:** under
Corepack, `--cwd` changes the target directory but still resolves the *yarn
version* from the real process cwd. Run from the repo root, `--cwd` silently
picks up the wrong yarn instead of the `yarn@4.10.0` this package vendors via
`.yarnrc.yml` (`yarnPath` + `nodeLinker: node-modules`). The `(cd DIR && yarn SCRIPT)`
subshell form makes the target directory the real cwd, so Corepack resolves the
correct pinned yarn.

## Build order when changing shared code

1. `(cd packages/evalforge-core && yarn build)` — rebuild this package first.
2. `(cd .github/actions/evalforge-yaml-gate && yarn build)` — rebuild the
   consuming action so `ncc` picks up the new output, and commit the
   regenerated `dist/index.js`.

Skipping step 1 leaves the action building against a stale `dist/` for this
package; skipping step 2 leaves CI running an old bundle that doesn't reflect
the source change at all.

## Known limitations / follow-up

- **Not published, no cross-repo use yet.** This package is workspace-local and
  consumed only via `portal:` inside this repo. Publishing to npm for reuse
  outside this repo is a later ticket.
- **`@actions/core` dependency, and duplicate bundling.** `src/auth.ts` imports
  `@actions/core` (for `core.setSecret`, to mask the minted OAuth token in
  action logs). Because this package has its own `node_modules` copy of
  `@actions/core`, `ncc` currently bundles `@actions/core` twice into the
  consuming action's `dist` — once for the action's own dependency, once for
  this package's — roughly doubling that portion of the committed bundle. The
  planned follow-up is to decouple `auth.ts` from `@actions/core` behind an
  injected `setSecret` callback (the action passes its own `core.setSecret`,
  or a no-op in tests), which removes the dependency from this package
  entirely and eliminates the duplicate bundling.
