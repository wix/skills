# Extraction-first artifact contract

Schema family: `0083.1`. The hand-authored JSON Schema 2020-12 files under
`schemas/` are authoritative. `scripts/generate-extraction-validators.mjs`
mechanically generates the dependency-free runtime validator committed at
`scripts/lib/extraction-validators.generated.mjs`; `--check` rejects schema and
validator drift. Semantic and cross-artifact checks remain in
`scripts/lib/extraction-contract.mjs`. Product runs do not download a validator.

## Scope and order

This workflow resolves and reconstructs one home page. Do not accept non-home
scope or explicit additional URLs until a later approved workflow defines their
resolution and shared-evidence rules.

1. Resolve the home page and `/` destination route.
2. Capture browser evidence across the required viewports and safe states.
3. Segment visible regions and assign exactly one owner.
4. Extract the foundation, metadata, and shared chrome.
5. Recursively extract section/component units.
6. Enforce the rendered-content boundary, then validate and freeze accepted or provisional specs.

Content-bearing fields come from browser-rendered text, never raw parent `textContent`.
`script`, `style`, `noscript`, and `template` descendants are non-content even when a
parent section is visible. Visible `pre`/`code` remains valid authored content and carries
visible-code provenance. A strong source-code contamination signal omits only the affected
strings, creates an owned local gap, and makes that unit provisional without blocking the
rest of the home-page workflow. The content-extraction semantics version participates in
the capture fingerprint so a capture made under older text semantics is not reused as the
same capture.
7. Derive a build plan only from the frozen manifest.
8. Build, verify, recover bounded gaps, and issue the final report.

## Canonical tree

```text
docs/site-clone/
  page-resolution.spec.json          # early durable resolution checkpoint
  extraction/
    latest.json                      # capture id + frozen manifest hash only
    <capture-id>/
      page-resolution.spec.json
      page-capture.spec.json
      observations/
        page.json
        assets.json
        seo.json
        tokens.json
        interaction-map.json
        scene-contract.json
        control-state-contract.json
        visual-assets.json
        layout-blueprint.json
        ui-normalization.json
        recursive-jobs.json
        packets/*.packet.json         # typed, sanitized replay inputs
      foundation.spec.json
      metadata.spec.json
      shared-chrome.spec.json
      sections/<section-id>/section.spec.json
      sections/<section-id>/components/<component-id>.spec.json
      extraction-gaps.json
      spec-index.json
      extraction-manifest.json
      replay-report.json              # replay captures only
  build/
    build-plan.json
    component-selection.json
    registry-installation.json
    section-implementation.json
  qa/
    visual-qa.json
    font-validation.json
    registry-opportunities.json
  final-report.json
  final-report.md
```

Observation files are retained inputs to deterministic projection. Their sanitized,
typed packet forms are the only replay inputs, and every packet/reference is paired
with a semantic hash in the manifest. Packet tampering therefore invalidates the
manifest before replay. Builders must not read observations or packets.
`spec-index.json` maps stable unit IDs to frozen spec paths;
`extraction-manifest.json` is the only authority for planning a build.

## Frozen specs

Every foundation, metadata, shared-chrome, section, and component spec has:

- `schemaVersion`, `kind`, stable `id`, and `pageKey: "home"`;
- `status: "accepted" | "provisional"`;
- source-neutral content/layout/style/behavior/reconstruction/acceptance fields
  appropriate to its kind;
- evidence/provenance references;
- direct dependency hashes;
- owned `gapRefs`;
- an immutable SHA-256 semantic hash.

An accepted spec supplies every required fact. A provisional spec supplies every
reliably observed fact and references at least one local gap naming every omitted
required field, assumption, dependency, and affected acceptance check. Builders
may implement the reliable portion but may not invent exact copy, assets, links,
business actions, or unobserved behavior.

## Serialization and hashing

Use RFC 8785 canonical JSON and SHA-256. Semantic hashes include schema version,
semantic fields, evidence references, detector versions, and direct dependency
hashes. They exclude timestamps, formatting, logs, and machine-specific absolute
path prefixes. A changed spec or dependency gets a new hash and invalidates stale
downstream ledger entries. A hash proves identity/integrity, not confidence.

All product artifact schemas reject unknown top-level fields. Extension data is
allowed only in the explicitly named `extensions` object with a namespaced key.

## Acceptance authority

Hard gates are deterministic and cannot be waived by the agent: schema validity,
referential integrity, exact ownership or explicit ignore/gap, required
provenance, safe-probe compliance, dependency closure, hash integrity, and no
unresolved global blocker.

Per-detector confidence is calibrated on the approved corpus. A high band must
meet at least 95% precision and may freeze automatically. Medium candidates become
compact typed decision requests for the orchestrating agent. Low confidence,
agent abstention, or invalid patches become gaps. The agent chooses only among
the typed choices and cannot override hard gates.

## Anti-stuck gaps

Each gap declares owner, local/global scope, missing fields, reason, confidence,
evidence, dependency closure, acceptance impact, attempts, remaining budget,
assumptions, omissions, and user decision.

- A local gap never stops unrelated extraction, freeze, build, or QA.
- Affected work receives at most two distinct targeted attempts. Repeating the
  same tactic without new evidence is rejected as no progress.
- After the budget is exhausted, the affected dependency closure freezes and
  builds provisionally.
- Only unresolved home identity, unusable page-wide capture, corrupt integrity,
  unisolatable safety failure, or inability to assemble/build/serve any viable
  shell is a global blocker.
- Local gaps remaining at handoff produce `done_with_gaps` and a final report;
  they do not produce a blocked run.

After assembly the user may accept, retry/fix, provide material, replace, omit,
or leave each provisional unit unresolved. Human acceptance does not relabel an
unverified unit as verified.

## Safe behavior evidence

Probe only public unauthenticated pages. Allow scrolling, hover, focus, keyboard
navigation, resize, bounded waits, and controls confidently classified as local
presentation changes (tabs, disclosures, menus, carousel controls). Block form
submission, authentication, cart/checkout, purchase/booking, uploads, account or
admin state, destructive controls, navigation, mutating requests, and any
unclassified click. Record blocked actions/requests and hard action/time budgets.

## Evidence lifecycle

Keep evidence local until explicit cleanup. Redact authorization/cookie headers,
secrets, sensitive query values, and form values before persistence. Content-hash
and deduplicate downloaded assets. Full browser traces/video are opt-in diagnostic
artifacts. Cap retained evidence at 250 MB, frozen specs/manifests at 10 MB, typed
agent decisions at 30, agent input at 50,000 tokens, and p95 extraction at ten
minutes on the approved benchmark.

Replay retained packets unless source fingerprint, required observation kind,
viewport/state set, capture semantics, or packet integrity changed. Detector,
schema projection, or typed-decision changes alone do not require recapture.

## Registry boundary

The shadcn-format registry under `registry/` contains only pinned, human-approved
runtime revisions. Candidate intake and review happen outside the published
skill under the repository's `registry-candidates/` workspace; deterministic
promotion copies only approved source, capabilities, the compact agent contract,
license, and approval record into `registry/`.

Selection code filters hard license/accessibility/responsive/SSR/RTL/reduced-
motion/runtime requirements and the hash-pinned generic `capabilities.json`
axes, slots, states, compositions, and constraints. It records rejection
evidence and the resolved typed binding in `build/component-selection.json`.
The building agent reads that selection record and, only for a selected item,
the referenced `contract.md`. It does not scan the registry or read capability
JSON, approvals, licenses, source provenance, candidate reviews, or live
documentation. When nothing qualifies, use the bounded custom builder.
