# Output contract

## Project and recovery boundary

The default output is `projects/<project-name>` using Wix CLI Headless, Astro,
TypeScript, and Tailwind. Standalone build mode must provision a real Wix project
before writing clone artifacts. Migration mode reuses the handoff-owned project;
it never creates or retargets a second site.

Browser extraction requires the host preflight. Retry shell/PATH/tool resolution in
the compatible interactive login shell, then request browser/network escalation and
retry. Sandboxed browser-launch or network failures are not terminal on first occurrence
in one-click mode.

## Implemented scope

The output owns one resolved home page at `/`. Additional static pages, explicit URL
scope, and multi-page shared-evidence conflict resolution are not implemented. Wix
business routes from a migration handoff may remain linked/preserved, but 0083 does
not reconstruct their visual pages.

## Required artifact tree

The durable source contract is:

- `docs/site-clone/page-resolution.spec.json`;
- `docs/site-clone/extraction/latest.json`;
- the referenced capture directory with observations, frozen specs, gaps, index,
  and manifest;
- `docs/site-clone/build/build-plan.json` and `component-selection.json`;
- `docs/site-clone/build/section-implementation.json`;
- `docs/site-clone/qa/` verification artifacts;
- `docs/site-clone/final-report.json` and `.md`.

Old flat `source-map.json`, `tokens.json`, `seo.json`, page/component handoffs, and
their resume semantics are not builder contracts. Extractors may produce equivalent
signals internally, but they are frozen under the capture's `observations/` directory
and only projected specs cross into building.

## Generated home page

- Verify the frozen manifest and build-plan hash before writing UI.
- Install the frozen foundation and metadata, then shared chrome, recursive
  components, and sections in declared dependency/source order.
- Preserve exact observed text, links, source media/logos/fonts, layers, layout,
  responsive behavior, accessibility, and safe observed interaction end states.
- Never invent missing copy, asset identity, navigation, business action, or
  behavior. Implement the reliable portion provisionally and link it to its gaps.
- Use Astro for static/content-heavy UI and React only for useful interactive
  islands with deliberate hydration.
- Select only pinned, human-approved items from the local registry. Record why an
  item was selected/rejected and the exact approved capability-manifest hash and
  agent-contract hash plus the resolved binding. Use only declared variations;
  expose only the generated selection and selected `contract.md` to the builder,
  and use the bounded custom path when none qualifies.
- Add stable `data-rp-unit`, manifest-hash, classification, state, and runtime
  markers needed by generated acceptance tests.
- Keep the implementation ledger keyed to frozen spec hashes. Code inspection
  cannot mark a unit verified.

## Gap and completion status

A local gap never blocks unrelated units. It receives at most two distinct targeted
recovery attempts and then becomes provisional. The assembled page is handed to the
user with choices to accept, retry/fix, provide material, replace, omit, or leave the
unit unresolved.

`final-report.json` and `.md` must identify what could not be imported reliably and
why, its evidence/confidence/attempts, assumptions/omissions, affected checks and
dependencies, provisional output, and user decision. Remaining local gaps produce
`done_with_gaps`; only a genuine global blocker produces blocked. A provisional or
user-accepted limitation is never described as verified.

## Migration terminal receipt

For `management_and_website`, `website/completion.json` is valid only after the
latest browser comparison/review has no unresolved critical/high identity finding,
the final report is present, and any requested facelift has its separate acceptance.
A successful build or backend import is not frontend completion. The receipt records
the handoff fingerprint, frozen manifest hash, release URL, final status, and evidence
references.
