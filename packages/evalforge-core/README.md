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
- **`plan-scenario-sync`** — `planScenarioSync({ local, remote, repo })`, a pure planner that
  diffs local `Scenario[]` against `RemoteScenario[]` by name and returns a
  `{ actions, skipped }` plan: `CREATE`/`UPDATE` for every local scenario
  (matched by name, mapped through `toEvalForgeBody`, tagged with
  `withManagedTags`), and `DELETE` for remote scenarios with no local match —
  but only when they already carry this repo's managed tag
  (`repoTagFor(repo)`); unmanaged remote-only scenarios are reported in
  `skipped` and left untouched. No network calls — deterministic and
  unit-tested against hand-built inputs.
- **`load-scenarios`** — `loadScenarios(root, globPattern)`, which globs scenario YAML
  files under `root` (excluding `node_modules`, `dist`, and the
  `.action-src/**` two-checkout convention), parses each with
  `parseScenario`, and returns a `Map<name, LoadedScenario>` plus a
  `LoadError[]` for unparseable files or duplicate scenario names.
- **`author-gate`** — `isWixAuthorEmail`, `getFirstCommitAuthorEmail` and
  `assertWixAuthor`, the shared "only run for `@wix.com` authors" check. The
  Octokit it needs is described structurally (`PullCommitsClient`) and the
  success log is an injected callback, so the package takes no dependency on
  `@actions/github` or `@actions/core` for this.
- **`action-inputs`** — `ensureHttps`, `safeGetSecret` and `getPrNumber`, the
  input plumbing both actions share. `@actions/core` and the event payload are
  passed in (`ActionsIo`, `PullRequestPayload`) rather than imported, for the
  same reason.

Everything is re-exported from `src/index.ts`.

## How it's consumed

This package is **not published to npm** (`package.json` sets `"private": true`).
Instead, `.github/actions/evalforge-yaml-gate` (wix-manage flows) and
`.github/actions/evalforge-skill-gate` (wix-app flows) each depend on it as a
local `portal:` dependency:

```json
"@wix/evalforge-core": "portal:../../../packages/evalforge-core"
```

and `ncc` inlines the built output into that action's committed
`dist/index.js` when the action is built. CI does not run `yarn install` or a
build step for the actions — it runs the committed bundle directly — so any
change to this package must be built, and the consuming action must be rebuilt
and its `dist` re-committed, before it takes effect in CI.

> The `sync` mode of `.github/actions/evalforge-skill-gate` and its
> `evalforge-wix-app-sync.yml` workflow are built on `planScenarioSync` +
> `loadScenarios`. That operational flow (repo YAML -> EvalForge on merge) is
> documented in the repo's `CONTRIBUTING.md`, not here — this package only
> provides the primitives.

## Local commands

Run these via a subshell, not `yarn --cwd`:

```bash
(cd packages/evalforge-core && yarn build)
(cd packages/evalforge-core && yarn test)
```

**Why the subshell and not `yarn --cwd packages/evalforge-core build`:** under
Corepack, `--cwd` changes the target directory but still resolves the *yarn
version* from the real process cwd. Run from the repo root, `--cwd` silently
picks up the wrong yarn instead of the `yarn@4.12.0` this package vendors via
`.yarnrc.yml` (`yarnPath` + `nodeLinker: node-modules`). The `(cd DIR && yarn SCRIPT)`
subshell form makes the target directory the real cwd, so Corepack resolves the
correct pinned yarn.

## Build order when changing shared code

1. `(cd packages/evalforge-core && yarn build)` — rebuild this package first.
2. Rebuild **both** consuming actions so `ncc` picks up the new output, and
   commit each regenerated `dist/index.js`:

   ```bash
   (cd .github/actions/evalforge-yaml-gate && yarn build)
   (cd .github/actions/evalforge-skill-gate && yarn build)
   ```

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
  `@actions/core`, `ncc` bundles it once per project into each consuming
  action's `dist` — the action's own copy plus this package's. With two
  actions that is four copies of `@actions/core` committed across the repo. The
  planned follow-up is to decouple `auth.ts` from `@actions/core` behind an
  injected `setSecret` callback (the action passes its own `core.setSecret`,
  or a no-op in tests), which removes the dependency from this package
  entirely and eliminates the duplicate bundling.
