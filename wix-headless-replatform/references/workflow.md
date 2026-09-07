# Home-page reconstruction workflow

## Modes and scope

The skill runs as a standalone clone or a migration phase selected explicitly by
`--handoff <website/handoff.json>`. Migration mode reuses the migration-owned Wix
site/project and binding intent. Standalone mode provisions one real Wix CLI
Headless Astro project.

The implemented extraction/build scope is one home page. `--scope` must be `home`
and `--urls` is not accepted. A later approved workflow must define resolution,
evidence conflicts, and shared ownership for additional pages.

When a migration handoff allows only `plan`, complete project context plus frozen
extraction/build planning and stop resumably. When it allows `build`, continue
through implementation and verification on the migration-owned project.

## Browser preflight

Before browser capture run:

```bash
node scripts/browser-extraction-preflight.mjs --project-root <project-root>
```

Use `--fix` for supported remediation. In this repository, align to the documented
NVM/Yarn toolchain first. For a sandboxed browser/network failure, request the required escalation and retry
before it becomes a global blocker.

## Stage order

1. Provision or verify the Wix project boundary when build mode requires it.
2. Resolve the requested URL to one public home page and destination `/` route.
3. Capture browser observations at desktop/tablet/mobile with normalization audit and
   persist typed, sanitized, hash-bound replay packets.
4. Run the independent semantic, structural, behavior, and visual detector ensemble;
   segment visible regions and assign ownership.
5. Plan recursive jobs and extract foundation, metadata, shared chrome, sections, and
   arbitrarily nested components deepest-first.
6. Classify and recover gaps within the bounded local budget.
7. Enforce the rendered-content boundary, then validate/harden hashes and freeze accepted or provisional specs. Content extraction must use browser-rendered text and exclude `script`, `style`, `noscript`, and `template` descendants. Preserve visible `pre`/`code` content with explicit provenance. If source-code contamination is still detected, omit only the affected strings, create an owned local gap, and continue unrelated units.
8. Derive the build plan and component-selection evidence from the manifest. If
   an approved registry item is selected, expose only its resolved binding and
   `contractRef` to the builder.
9. Build foundation, metadata, chrome, recursive children, then ordered sections.
10. Build and run unit/page browser QA; revise only affected owners.
11. Produce the final gap report and, when applicable, the migration receipt.

Resolution/extraction may create observations and specs, but never destination UI.
Building consumes only frozen specs, generated selection evidence, and any
selected component's compact agent contract. It may not browse the source, scan
the registry, read candidate/review material, or read raw observations. A
missing builder fact returns through an owned extraction-gap request.

## Page resolution

Normalize the input, remove fragments/query discovery noise, follow redirects with a
read-only request, preserve an applicable locale home prefix, inspect canonical URL,
and record requested/candidate/resolved/canonical URLs. Ambiguous home identity is a
global blocker with an exact user action; do not guess a route or build the supplied
non-home page as home.

## Capture and safe probing

Capture the clean page after stable settling, controlled scrolling, lazy-content
discovery, and consent/obstruction normalization. Retain raw and normalized evidence
plus every normalization action.

Probe only public unauthenticated presentation state. Allow scroll, hover, focus,
keyboard navigation, resize, bounded wait, tabs, disclosures, menus, and confirmed
carousel controls. Block navigation, mutating requests, forms, auth, cart/checkout,
purchase/booking, uploads, account/admin state, destructive actions, and unclassified
clicks. Reset state between branches and retain an audit of blocked requests/actions.

## Freeze and anti-stuck behavior

Every visible concern has one owner, explicit ignore, or owned gap. High-confidence
detector results that meet calibrated precision may freeze automatically. Medium
results become typed decisions for the orchestrating agent. Low/invalid/abstained
results become gaps.

Local gaps never block unrelated work. Try at most two distinct targeted tactics. If
the fact remains unavailable, freeze/build the reliable contract provisionally and
propagate provisional status only through declared dependencies. The agent may make a
conservative evidence-backed layout/semantic choice, but cannot invent copy, assets,
links, business actions, or behavior.

Only unresolved home identity, page-wide unusable capture, corrupt artifact integrity,
unisolatable safety failure, or inability to assemble/build/serve any viable shell stops
the run globally.

Replay a retained immutable capture without reopening the source with:

```bash
node scripts/replay-extraction.mjs --out <project> [--capture <capture-id>]
```

Replay first verifies spec, dependency, manifest, and observation-packet hashes. A
changed detector/projection or typed patch creates a new capture and report; the source
capture remains untouched.

## Build order and registry

Verify `extraction/latest.json` and its manifest before creating UI. The build ledger
is keyed to manifest/spec hashes; a changed hash invalidates the affected downstream
entries.

Install the foundation once, apply metadata, then build shared chrome, recursive child
components, and top-level sections in dependency/source order. Use Astro for static UI
and React only for useful islands. Preserve exact content/assets, layers, geometry,
responsive behavior, accessibility, and observed end states.

Filter the local shadcn-format registry by contract, its approved hash-pinned capability
manifest, framework/runtime, license, accessibility, responsive, SSR, RTL, reduced-motion,
dependency, and human-approval requirements. Resolve only declared axes, slots, states,
and compositions, and record selection/rejection evidence. An eligible selection is copied
from its pinned local source only after its exact source hash is verified; exact
dependency versions, required Astro integration configuration, and
`build/registry-installation.json` record the installation. The builder consumes the
resolved selection and only the selected item's hash-pinned `contract.md`; registry
internals and candidate material are not agent context.
Use a bounded custom builder when no item qualifies and emit a source-neutral
`qa/registry-opportunities.json`; never fetch a floating live-registry component.

## Verification and completion

Verify each unit at its required viewports against frozen acceptance fields, then verify
the assembled home page. `qa/visual-qa.json` contains `unitAcceptance` results for every
frozen required criterion and `pageAcceptance` results for page checks; pending browser
evidence is reported as pending, never silently passed. Findings return to their smallest
owner. Do not use unrelated global CSS or another section to hide a gap.

Generate `final-report.json` and `.md`. For every unresolved/user-accepted gap state what
could not be imported reliably and why, evidence/confidence/attempts, provisional output,
assumptions/omissions, affected checks/dependencies, and choices to accept, retry/fix,
provide material, replace, omit, or leave unresolved.

Record a post-assembly decision with:

```bash
node scripts/record-gap-decision.mjs --out <project> --gap <gap-id> --decision <choice>
```

No remaining gap plus complete browser verification may become done. Remaining local
gaps become `done_with_gaps`; only a global blocker is blocked. In one-click mode do not
pause before assembly for local gaps.
