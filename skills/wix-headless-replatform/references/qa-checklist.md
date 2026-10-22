# Home-page QA checklist

Run QA after manifest-derived implementation. A build is not acceptance.

## Frozen boundary

- `extraction/latest.json` matches the frozen manifest hash.
- Every spec and dependency hash verifies before QA.
- Every typed replay packet/reference hash verifies; a changed packet rejects replay.
- Every build-plan unit has a matching implementation-ledger entry and spec hash.
- `qa/visual-qa.json` contains one `unitAcceptance` record per planned unit and every
  required frozen criterion is verified, pending, failed, or explicitly gap-backed.
- Accepted units contain every classification-required field; every provisional
  omission is represented by an owned local gap.
- No builder/QA code rediscovered a source fact or read observations to fill a spec gap.

## Unit fidelity

For foundation, metadata, shared chrome, each recursive component, and every section:

- Run the spec's content/order, asset, layer, layout, responsive, behavior,
  accessibility, and visual/geometry acceptance checks at every required viewport.
- Preserve exact visible copy, menu/footer hierarchy, links, logos/media/font tuples,
  background/media role, positioned layers, and important text geometry.
- Preserve observed control states, keyboard semantics, initial state, interaction end
  states, reduced motion, and runtime initialization markers.
- Keep each finding on its smallest owning unit. Do not compensate through unrelated
  global CSS or another section.
- Mark status `verified` only from rendered/browser evidence. Keep gap-backed work
  `provisional`; human acceptance is `user-accepted`, not verified.

## Page fidelity

- The home route builds and serves in the actual Wix Headless Astro project.
- Foundation/global CSS is installed once and shared chrome remains a first-class unit.
- Section order, full-page rhythm, desktop/tablet/mobile reflow, first viewport, and
  page-level behavior match the frozen page contract.
- SEO metadata is applied without leaking metadata-only text into visible hero content.
- Consent infrastructure marked ignored is not cloned as content.
- No placeholder, clone-process, migration, or development copy appears.
- External links remain absolute and preserved internal links behave honestly.

## Registry

- `build/component-selection.json` names the frozen manifest.
- Every selected item is a pinned local registry revision with a valid human approval,
  license record, runtime class, source hash, capability-manifest hash, agent-contract hash,
  and quality evidence.
- The resolved binding uses only manifest-declared axes/values, slots, states, and
  compositions; unsupported requirements have deterministic rejection evidence.
- The builder read only `component-selection.json` and the selected item's `contract.md`;
  candidate reviews/provenance and registry internals were not added to agent context.
- Astro/static versus React-island use is deliberate; interactive islands declare
  hydration and accessible no-JavaScript behavior.
- Items pass accessibility, keyboard, focus, responsive, SSR, RTL, reduced-motion,
  dependency, styling-isolation, and state/variant checks.
- When no item qualifies, rejection evidence exists and the bounded custom path is used.
- `build/registry-installation.json` proves each selected local file hash and exact
  dependency/capability binding; `qa/registry-opportunities.json` records reusable custom gaps.

## Browser comparison and recovery

- Run interaction verification and `post-build-gap.mjs` against the running home page.
- Open every desktop/tablet/mobile screenshot pair at original size and write one complete
  `visual-review.json` record per pair.
- Fix missing structure/content/media first, then composition/geometry, core behavior,
  and supporting polish.
- For prior critical/high findings, `visual-progress.json` links canonical source,
  before-result, and after-result screenshots and proves visible improvement.
- A local evidence gap uses at most two distinct targeted recovery attempts. Repeating a
  tactic without new evidence is no progress. After exhaustion, preserve the unit
  provisionally and continue unrelated QA.
- Only unresolved home identity, unusable page-wide capture, corrupt integrity,
  unisolatable safety failure, or inability to assemble/build/serve any shell is blocked.

## Final report

- `final-report.json` and `.md` name every unresolved/user-accepted gap, visible location,
  unavailable fact and reason, evidence/confidence/attempts, provisional implementation,
  assumptions/omissions, affected checks/dependencies, and user choices.
- No gaps plus reviewed passing browser evidence may become `done`.
- Remaining local gaps become `done_with_gaps`.
- Only a global blocker becomes `blocked`.
