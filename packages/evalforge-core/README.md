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
- **`reconcile`** — `reconcile({ local, remote, repo })`, a pure planner that
  diffs local `Scenario[]` against `RemoteScenario[]` by name and returns a
  `{ actions, skipped }` plan: `CREATE`/`UPDATE` for every local scenario
  (matched by name, mapped through `toEvalForgeBody`, tagged with
  `withManagedTags`), and `DELETE` for remote scenarios with no local match —
  but only when they already carry this repo's managed tag
  (`repoTagFor(repo)`); unmanaged remote-only scenarios are reported in
  `skipped` and left untouched. No network calls — deterministic and
  unit-tested against hand-built inputs.
- **`loader`** — `loadScenarios(root, globPattern)`, which globs scenario YAML
  files under `root` (excluding `node_modules`, `dist`, and the
  `.action-src/**` two-checkout convention), parses each with
  `parseScenario`, and returns a `Map<name, LoadedScenario>` plus a
  `LoadError[]` for unparseable files or duplicate scenario names.

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

## Sync mode: repo YAML -> EvalForge

`.github/actions/evalforge-yaml-gate`'s `sync` mode is built on `loadScenarios`
+ `reconcile`: it loads the repo's scenario YAML via a caller-supplied
`evals-glob`, fetches the current remote scenarios for the target
`evalforge-project-id`, computes a plan with `reconcile`, and applies it
(CREATE/UPDATE/DELETE) unless `dry-run: 'true'`, in which case it only logs
the plan. Sync is **one-way** (repo -> EvalForge; it never reads results back
into YAML) and deletes are scoped to scenarios this repo already manages, so
UI-authored or other repos' scenarios are never touched.

`.github/workflows/evalforge-wix-app-sync.yml` drives this on every PR merged
into `main` that touches `yaml/wix-app-evals/**`: it checks out the merge
commit and runs the gate action in `sync` mode against the
`APP_BUILDER_PIPELINE_PROJECT_ID` project, currently with `dry-run: 'true'`
(applying is a deliberate follow-up once the logged plan has been verified).

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
