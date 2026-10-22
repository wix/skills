---
name: rp-project-context
description: Resolve headless mode, scope, Wix project validity, and browser execution readiness.
---

# Project context

Load this resource only when the run's mode, source/scope, output project, approval state,
or browser environment is unresolved. It owns setup decisions, not extraction or UI work.

Read `references/safety.md` and the applicable mode/scope and preflight sections of
`references/workflow.md`. Read `references/output-contract.md` only when validating the
project or automation-state artifact.

## Resolve mode and scope

- Standalone uses the public source URL and requires `home` scope with no `--urls`.
- Migration mode requires `--handoff`. Read its route families, public URL intent, Wix
  bindings, slug policy, `websiteScope`, `automationMode`, and
  `frontendPhase.allowedNow`. The handoff is authoritative.
- If a handoff requests non-home or explicit-URL reconstruction, stop with the actionable
  requirement for the future multi-page workflow. One-click mode does not expand scope.
- In `plan` phase, write/refresh plan-eligible context and evidence only; do not require a
  runnable frontend or attempt build/release. In `build`, validate the existing
  migration-owned project before proceeding.

## Provision or validate the project

For standalone home cloning, provision or verify the exact final output directory before
artifact generation or UI writes. It must be a real successful Wix CLI scaffold, not a
manual fallback, and contain a valid Wix configuration plus `package.json` `dev` and
`build` scripts. Create its empty `yarn.lock` project boundary up front. If the scaffold
uses `@wix/astro-wix-hosting-adapter`, remove a direct standalone
`@astrojs/cloudflare` dependency before install/build normalization.

For migration mode, reuse the handoff-owned project/site only. If project identity or its
runnable contract fails, record the precise failure and recover it; never create a sibling
scaffold.

Use `clear-wix-starter.mjs` after a valid template creates demo files, before clone UI
work starts.

## Browser preflight and recovery

Before browser extraction run:

```bash
node scripts/browser-extraction-preflight.mjs --project-root <project-root>
```

If needed, first attempt `--fix`. The host must have normal `node_modules` resolution,
required browser/design dependencies, and Chromium; Yarn Plug'n'Play is not sufficient.

For this repository, run path-sensitive Wix/Yarn commands in interactive `zsh` with the
repo-local NVM toolchain. In a one-click run, retry a shell/PATH mismatch once under that
aligned shell. If browser launch or network access is sandbox-blocked, request the required
escalation and retry. Only then record a blocker; a pending runtime approval is a real
wait, not a reason to ask unrelated routine confirmations.

Write/update `frontend-automation-state.json` whenever the mode, phase, effective scope,
scope checkpoint, or auto-progress policy changes. Return to the root supervisor once the
context is durable.
