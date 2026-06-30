---
name: rp-execute-import
description: >-
  Runs the generated extract/import pipeline and records execution results. Use when setup
  and codegen are complete and the user has approved the execution plan.
---

# rp-execute-import

Execute the generated migration pipeline and capture import results.

## Purpose

This skill runs the generated extract/import pipeline for the active project once setup and code generation are complete.

## Required inputs

- generated code under `migrations/<project>/src/`
- `migrations/<project>/import-plan.md`
- `migrations/<project>/setup-verification.md`

## Preconditions

Do not proceed until:

- setup verification shows required items are passed or accepted; an unrecovered blocker
  halts to needs-user
- reader, transform, and writer code exist for the intended entities
- execution strategy for batching, retries, and checkpoints is clear
- the **execution plan report has been presented and the user has accepted it** (see
  below)

## Execution plan & user acceptance (required gate)

This gate precedes **all** writes to the user's site — both `rp-execute-setup`
provisioning and this import. Before writing anything, produce a human-readable
**execution plan report** and obtain explicit user acceptance. Do not write anything until
the user accepts. The report must show:

- **Setup changes to be made first:** apps to install (Blog / Members / Wix-Data enabler),
  Wix Data enablement, and collections to create — so the user sees the site changes, not
  just the content writes.
- **What will be imported and where:** each source entity → its Wix target (app or
  collection) with record counts — e.g. posts → Wix Blog (1088); episodes →
  `PodcastEpisodes` (86); categories/tags → Blog taxonomies; media → Media Manager (~1499).
- **What will NOT migrate cleanly / needs manual action:** the lossy and blocked items,
  drawn from the mapping plan's faithfulness ledger and any `setup-verification.md` items
  still manual or blocked — e.g. category hierarchy flattened, comments anonymized,
  drafts absent without auth, storage-plan upgrade required. **This must also include any
  target with no verified Wix primitive** — state whether it falls back to a generic CMS
  collection, to an `unverified`/best-effort runtime-derived call, or is skipped. Nothing
  unverified or lossy may be written without first appearing here for consent.
  Coupons follow the same native-first rule as other native Wix entities: prefer native
  Wix Coupons, and mention CMS fallback only for truly unsupported coupon semantics.
  - **Always state the analytics-data exclusion explicitly.** Historical analytics data —
    traffic / visitor stats accumulated on the source — is **out of scope** and is **not**
    imported (see "Out of scope" below). Call this out in the plan so the user knows before
    accepting that analytics data will not migrate; do not let it pass silently.
- **Order & idempotency:** the write order and how re-runs dedupe. Be explicit that
  source IDs are the stable migration key, while many native Wix target IDs are
  server-assigned. The plan must state whether each entity re-run resolves via a
  client-controlled source-id field on the target or via a durable `sourceId -> targetId`
  crosswalk.

Persist this in `import-plan.md` (or a sibling report). This is the defined approval
checkpoint: the job pauses, surfaces the plan to the user, and resumes **only** on
accept. Nothing is written before acceptance.

## Out of scope — analytics (future enhancement)

**Do not attempt to import analytics data.** Historical traffic / visitor statistics —
the accumulated analytics records on the source (page views, sessions, visitor counts,
time-series reports) — are **not** part of the migration. Do not generate readers,
transforms, or writers for them. (This is about the *data*, not analytics
configuration/setup such as tracking tags — that is a separate concern and not what this
exclusion covers.)

- **Surface it before execute.** This exclusion must appear in the execution-plan report's
  "What will NOT migrate" list (see the gate above) so the user is told **before** they
  accept and we begin writing — not discovered afterward.
- **Future enhancement.** Analytics migration is a deferred scope item, not a permanent
  limitation. If/when a faithful source→Wix analytics path exists, revisit and lift this
  exclusion. Until then, treat analytics as explicitly skipped.

## Execute the generated scripts — never an agentic MCP flow (required)

The **import** is performed by **running the generated artifact** (`node` the project's
entrypoint under `migrations/<project>/src/`), which writes to Wix via its own transport
(`fetch` + injected credentials to `www.wixapis.com`, or the Wix client SDK). The agent
**must not** perform the import writes itself by issuing per-record Wix MCP calls
(`CallWixSiteAPI`) and hand-translating shapes.

(Scope: this rule is **import-specific**. Setup execution (`rp-execute-setup`) may
currently use the agent+MCP for provisioning writes — an interim decision, with other
options still under discussion.)

Why the import must run the artifact:

- **Reproducibility & idempotency.** Re-runs, resume-from-checkpoint, write ordering, and
  dedup keyed by source ID live in the artifact. For native Wix entities whose target IDs
  are server-assigned, that means the artifact must maintain and consult a durable
  `sourceId -> targetId` crosswalk. An agent reconstructing writes ad hoc bypasses all of
  it — a bulk, restartable data pipeline can't be driven by hand per record.
- **Verified shapes.** The artifact calls `rp-target-wix`'s verified primitives. An agent
  rebuilding request bodies live re-opens the exact shape-bug class we eliminated
  (FR-007 Ricos enums, FR-009 tag body, FR-010 `heroImage.id`).
- **MCP may be absent at runtime.** Interactively-authenticated MCP servers can be missing
  in headless/cron runs, so MCP can't be depended on as the write transport regardless of
  whether the runtime is a pure script-runner or an agent. Either way the writes should
  flow through the tested artifact, not be reconstructed by the model.
- **Validation honesty.** Writing by hand via MCP leaves the artifact's own auth, request
  execution, async-media polling, retry, and checkpoint code unexercised — a green test
  then says nothing about the path real users get. The Wix MCP's role here is
  grounding/verification at codegen time and the one-time live contract test in
  `rp-target-wix`, **not** the import transport.

Consequence for credentials: the artifact needs real Wix write credentials to run. If they
are absent, **halt to needs-user** — do **not** substitute the agent's MCP account auth to
"get the writes done." Missing credentials is a blocker to surface, not a path to route
around. (Note: the wporg-news Run 2/3 live writes went through the agent+MCP as a no-token
test stand-in. That validated request *shapes* only; it is explicitly **not** how import
runs — the artifact's own `fetch`/auth/polling path still needs a live end-to-end validation.)

## Config files

Before running the generated entrypoint, verify the project-local config files exist and
contain required values:

- `migrations/<project>/config/wix.env`
  - `WIX_SITE_ID`
  - `WIX_AUTH_TOKEN` or another generated-code-supported Wix auth key
- `migrations/<project>/config/source.<platform>.env`
  - platform-specific source values, for example WordPress:
    `WP_BASE_URL`, `WP_USERNAME`, `WP_APPLICATION_PASSWORD`

The generated script should load these files and then allow process env to override them.
If a required key is missing or blank, halt to needs-user with the exact key name. Never
print secret values.

Treat `migrations/<project>/config/*.env` as secret-bearing once they may contain real
values. Do not inspect them with whole-file reads that print contents into tool output;
check only existence and required-key status (`present`, `blank`, `missing`).

## Workflow

1. Resolve the active project.
2. Review the import plan and generated code; present the execution plan report and obtain
   acceptance (see above) before any write.
3. Run a safe validation path first when possible, such as dry-run, sample batch, or read-only validation.
   If media import is in scope and source media URLs are local/private (`localhost`,
   `127.0.0.1`, Docker-only hosts, etc.), do not treat a successful dry-run as proof that
   live media import can work. Wix Media import fetches URLs from Wix servers, so the user
   must either expose the source through a public HTTPS tunnel or skip/defer media. This
   is optional and, as far as we know today, only affects media import.
4. **Run source extraction first** using the generated reader entrypoint (for example
   `node src/extract-source.js`, or an equivalent `run-import.js --extract-only` mode).
   This step writes durable source files under the project and must complete before the
   write phase.
5. **Execute the import by running the generated import entrypoint** (for example
   `node src/run-import.js` or `node src/run-import.js --import-only`) with credentials
   injected via config/env. The import must read from the extracted files on disk — not by
   re-reading the source into memory, and not by issuing writes through the agent/MCP.
6. Capture counts, errors, retries, skipped records, and checkpoint information.
7. Save a durable execution log.

## Localhost media before live import

When source media URLs are local/private, ask the user to choose one path before live
media writes:

- Expose the source with a public HTTPS tunnel such as ngrok:

  ```bash
  brew install ngrok
  ngrok config add-authtoken "<YOUR_AUTHTOKEN>"
  ngrok http 8090
  export WP_BASE_URL=https://<id>.ngrok-free.app
  ```

- Or skip/defer media import and record the effect on hero images, galleries, downloadable
  files, and other media-dependent references.

Non-media entities may continue if the execution plan clearly excludes or defers media.

## Artifact to create or update

- `migrations/<project>/execution-log.md`

## Minimum execution log contents

- run timestamp
- command or entrypoint used
- extracted source location / manifest used
- entities processed
- records read, transformed, written, skipped, failed
- retry behavior
- blocking errors
- follow-up remediation

## Guardrails

- **Import writes go through the executed artifact, not the agent.** Never perform import
  writes via `CallWixSiteAPI`/MCP as a substitute for running the script. MCP is
  verification-only here (see the section above). (Setup execution is out of scope for this
  rule — see `rp-execute-setup`.)
- Prefer dry-runs or sample batches before full import.
- Stop on systemic mapping or write failures rather than amplifying bad writes.
- Preserve enough logging to support replay and debugging.
