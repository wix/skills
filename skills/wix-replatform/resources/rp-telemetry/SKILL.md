---
name: rp-telemetry
description: >-
  Always-active telemetry companion for RePlatform migration runs. Records what happened
  during a run — halts, errors, fidelity losses, API gaps, skill coverage gaps, user
  decisions, pipeline defects — through a validated recorder script, plus the run rollup
  (stages, timings, volumes, verification). Loaded by the orchestrator at run start and
  kept active for the whole run.
---

# rp-telemetry

Capture per-run telemetry that tells us what to improve in the skills and the underlying
Wix tooling. This skill stays active alongside the migration skills for the **entire**
run; the migration skills themselves are unchanged and know nothing about telemetry.

## The one rule that governs everything you record

**Observation, not diagnosis.** Every field records what was observed — what happened,
what was expected, what actually occurred, where, and how often. Never record a root
cause, a fix, a recommendation, or a workaround-as-solution. There is deliberately no
field for them; the schema rejects unknown fields. Root cause is derived later, at review
time, by a reviewing agent with full context — not asserted by you in the moment.

Three discipline rules apply to every free-text field (`what_happened`, `expected`,
`actual`):

- **Types, not instances.** Refer to entity *types* and *classes*, never specific client
  data. `entity_type: "product"` — never a product's name, SKU, price, or body text.
- **Secret-safe.** No credentials, tokens, URLs, config values, or file contents — the
  recorder also runs a mechanical scrub as a last line of defense, but do not rely on it.
- **Short and structural.** A sentence or two, max 400 chars. Prefer stating
  expected-vs-actual over narrating. The coded fields carry the structure.
- **No remediation narration.** "The canonical lib was fixed and re-synced" is a fix
  story, not an observation — even when true (dev-mode backports). Record what was
  observed to work ("adding fieldsets=FULL returned the field; the lookup succeeded")
  and leave the repair to the execution log.

## The recorder

All telemetry is persisted through the bundled recorder — **never hand-write or edit
`run-telemetry.json` or `telemetry/` files.** Run it from this resource directory
(see `CONVENTIONS.md`), pointing at the active migration project:

```bash
node scripts/rp-telemetry.js <command> [...] --project <abs path to migrations/<project>>
```

The recorder owns everything mechanical: schema validation (it rejects invalid enums and
unknown fields — fix and retry, never guess around it), timestamps, per-class event
folding, the run/attempt/session resume model, the privacy scrub, and the well-formedness
gate at finalize. It prints one JSON result per call; `{"ok":false,...}` lists exactly
what to fix.

| Call | When |
|---|---|
| `start '<dims-json>'` | At run begin — before any other pipeline step. Resumes an unfinalized run automatically. |
| `dims '<dims-json>'` | Whenever a dimension becomes known mid-run (platform version and extensions after discovery, `site_id` after provisioning). |
| `stage start <stage>` / `stage end <stage> --outcome <outcome>` | At every stage boundary. Outcomes: `passed`, `halted`, `failed`, `skipped`. |
| `meter [--api-ms N --model-ms N --script-ms N --input-tokens N …]` | Measured latency/token counts for a stage. Call it whenever you have real numbers; see "Metering" below. |
| `wait start [--halt <subtype> --skill <s> [--what '<text>']]` / `wait end` | The moment the run halts for the user, and the moment it resumes. This is how user latency stays out of `active_ms` — never estimate elapsed time yourself. Pass `--halt` for a needs-user halt and the recorder emits the paired `halt_needs_user` event for you. |
| `record '<event-json>'` | The moment something observable happens (taxonomy below). |
| `finalize '<rollup-json>'` | When the run reaches a terminal state. |
| `rebuild [--attempt <n>] [--push]` | Only on request, to re-assemble a past run's signal document from its archived journal after a recorder fix — never during a run. `--push` re-emits the rebuilt run to the BI sink (backfill after an outage; idempotent — the reviewer dedupes at query time). |
| `status` | To orient after a resume. |

### Run lifecycle

1. **`start`** as the first telemetry act of the run, with whatever dimensions are already
   known:

   ```bash
   node scripts/rp-telemetry.js start '{"source_platform":"wordpress",
     "source_site_url":"https://client-site.example","source_acquisition":"public_storefront",
     "delivery_mode":"management","destination_strategy":"new_site",
     "runtime_env":{"agent_runtime":"claude-code","model":"<model id>"}}' --project <dir>
   ```

   `start` on a project with an unfinalized run **resumes** it (same run, same attempt,
   one more session) and closes any open wait interval. `start` after a finalized run
   opens the next attempt. Never try to manage run identity yourself.

   `source_acquisition` is an open set of class tokens, but reuse an established one
   (`admin_api`, `public_storefront`, `public_content`, `file_export`) rather than
   minting a synonym — cross-run folding depends on stable tokens.

   **Skills provenance is auto-stamped — you don't pass it.** At `start` the recorder
   stamps two identifiers onto the run so every record can be traced back to the skills
   that produced it:

   - `skills_version` — the bundle's semver release label (from `VERSION`). Coarse and
     hand-bumped by design; it is the group-by/order-by key that binds issues to a
     *release line* ("all issues on 1.2.x", "regressed since 1.1.0").
   - `skills_commit` — the exact source commit the bundle was built from: the precise
     *vendored snapshot* within a release. Many commits ship under one hand-bumped
     `skills_version`, so a run reporting `1.0.0` is otherwise unattributable to the
     change that produced its issue. The recorder resolves it, in order of authority,
     from the `sourceCommit` stamped into `.publish-manifest.json` at publish time (the
     only source that works in a partner runtime, and the only correct one once the
     bundle is vendored into `wix/skills`), else a dev-mode `git rev-parse --short HEAD`
     of the source checkout, else `null`.

   Both may be overridden by passing `skills_version` / `skills_commit` in the `start`
   dims (a runtime with better provenance than the recorder can infer), but normally you
   leave them to auto-resolve.

2. **Stage boundaries** as the pipeline moves. Map orchestrator steps to stages like this:

   | Stage | Covers |
   |---|---|
   | `config` | Everything before discovery: project resolution, config files, up-front input collection |
   | `discovery` | Source discovery (`rp-discovery` + source adapter) |
   | `mcp_gate` | The Wix MCP prerequisite gate between discovery and mapping |
   | `mapping` | `rp-mapper` producing the mapping plan |
   | `mapping_review` | The mapping review checkpoint (user-facing) |
   | `setup_discovery` | `rp-setup-discovery` |
   | `codegen` | `rp-import-codegen` |
   | `approval_gate` | The execution-plan approval gate (user-facing) |
   | `setup_provisioning` | Site creation, app installs, collections — `rp-execute-setup` |
   | `storefront_build` | The `website`-mode `wix-headless` build + release; `skipped` in `management` mode |
   | `extract` | Source extraction to disk, before any write (`rp-execute-import`) |
   | `import` | The import writes (`rp-execute-import`) |
   | `finish` | Verification spot-checks, completion reporting, handoff |

   Stages bind to **when the work actually runs**, not to their canonical order. If the
   orchestration runs extraction early (e.g. extract + dry-run before the approval gate,
   inside the codegen phase), close the open stage, bracket the extraction in its own
   `extract` stage, then reopen — a stage may be entered more than once, and its
   `active_ms` sums the entries. Booking a real extraction into `codegen` (and leaving
   `extract` as a milliseconds-long token stage) is exactly the mis-attribution the
   `extract` stage exists to prevent.

   When the `discovery` stage ends, **always** stamp what it learned:
   `dims '{"source_platform_version":"...","source_extensions":["..."]}'` — pass `[]`
   explicitly when discovery found no extensions; a null left behind is flagged in
   `telemetry_health` as `source_extensions_null_after_discovery`.

3. **`wait start` / `wait end`** around every needs-user halt: credential requests, the
   mapping-review checkpoint, the approval gate, any halt-to-needs-user. Pass the halt
   class on the same call —
   `wait start --halt missing_input --skill rp-mapper --what "run halted at the mapping-review checkpoint awaiting approval"`
   — and the recorder emits the paired `halt_needs_user` event mechanically; a stalled
   wait with no halt event in its stage is flagged in `telemetry_health`
   (`wait_without_halt_event:<stage>`). If the session is about to end on a halt, leave
   the wait open — the resume's `start` closes it, so overnight user latency lands in
   `waiting_ms` where it belongs. If you resume real work while a wait is open (e.g.
   investigating something before the user has answered), `wait end` first and
   `wait start` again when you go back to waiting — active work must never be booked as
   waiting.

4. **`record`** events as they happen (next section). Record in the moment, not
   retrospectively — improvisation and halts are only reliably knowable when they occur.

5. **`finalize`** once, at a terminal state, with the rollup:

   ```bash
   node scripts/rp-telemetry.js finalize '{"terminal_state":"completed",
     "volumes":[{"entity_type":"product","target":"native","target_surface":"stores/v3",
       "discovered":142,"planned":142,"attempted":142,"succeeded":139,"failed":3,
       "skipped":0,"already_imported":0}],
     "verification":[{"subject":"product","method":"query_back","checked":10,"passed":10,"failed":0}],
     "operator_acceptance":"accepted"}' --project <dir>
   ```

   - `volumes` come from the execution artifacts (manifest, audit log, crosswalk):
     `planned` and `target`/`target_surface` from the **approved** plan;
     `already_imported` is crosswalk-skipped scope from a prior attempt — never fold it
     into `skipped`.
   - Include a volume row for **every** entity type discovery found in use — including
     types excluded by user decision or with no clean Wix target (`discovered: N,
     skipped: N`, `target: none` where no target exists, `planned` 0 or null). "What we
     cannot or chose not to import" must be signal-layer arithmetic, never an evidence
     dig — rows only for imported types silently erase the excluded half of the approved
     plan.
   - `verification` makes the finish step's spot-checks countable. `checked: 0` is an
     honest "written but unverified" — report it rather than papering over it.
   - Do **not** finalize a halt you expect the user to resume — leave the run unfinalized
     with the wait open. Finalize with `halted_needs_user` only when the run is genuinely
     being closed out in a stalled state. A user who declines the plan is
     `abandoned_by_user` (plus a `user_decision` event with `subtype: declined`), never
     `halted_needs_user` or `failed`.

### Metering — splitting `active_ms` into where the time actually went

`active_ms` alone cannot locate a bottleneck: it is wall-clock between two stage boundaries, fusing
**model reasoning + subprocess execution + remote API latency + defect-repair time** into one
number. `meter` splits it, and cost is derived from the token counts.

```bash
# a generated script reporting its own measured work
node scripts/rp-telemetry.js meter --api-ms 250000 --api-calls 73 --api-retries 2 --script-ms 1200 --project <dir>
# the agent runtime reporting its own usage for the stage it just finished
node scripts/rp-telemetry.js meter --model-ms 42000 --input-tokens 8000 --output-tokens 1500 --cache-read-tokens 120000 --project <dir>
```

**Derive the API half mechanically — do not hand-count it.** After a generated import runs:

```bash
node scripts/meter-from-audit.js --project <migration dir> --stage import   # --dry-run to preview
```

It reads `logs/import-audit.ndjson` and emits measured `api_ms` / `api_calls` / `api_retries`.
It exists because a bulk write logs **one audit row per item, each carrying the batch's total
latency** — summing rows multiplies one call's latency by its item count, which on a real run
reported 1,050,992 ms of API time inside a stage that only existed for 346,505 ms. The helper
collapses rows per distinct `(runId, endpoint, batch, latencyMs)`, so a batch counts once while
genuinely separate calls each count.

Fields: durations `model_ms` / `api_ms` / `script_ms`; counts `input_tokens`, `output_tokens`,
`cache_read_tokens`, `cache_write_tokens`, `api_calls`, `api_retries`. Defaults to the open stage;
`--stage <stage>` targets another. Repeated calls **accumulate**, so each script invocation and each
stage re-entry reports independently.

Rules that keep the numbers trustworthy:

- **Measure, never estimate.** Every field is a number something actually observed — a script's own
  elapsed time, an audit log's summed `latencyMs`, the runtime's reported usage. If you do not have
  a measurement, omit the field; the gap is reported as `unattributed_ms` and flagged, which is far
  more useful than a guess.
- **Do not meter the same interval twice.** Meters sum, so re-reporting a stage's API time after a
  resume double-counts it. The recorder flags `stage_over_attributed:<stage>` when attributed time
  exceeds elapsed time, because `unattributed_ms` clamps at zero and would otherwise hide it.
- **Cost is derived, never recorded.** Pass `model_pricing_snapshot` in the `start` dims
  (`{ "<model>": { "input_per_mtok": 15, "output_per_mtok": 75, "cache_read_per_mtok": 1.5 } }`) and
  the rollup computes `cost.estimated_cost_usd`. A stored dollar figure silently goes wrong when list
  prices change; tokens plus a dated snapshot stay recomputable. Without a snapshot, cost is `null`
  with `cost_basis: "no_pricing_snapshot"` — never a fabricated number.
- **`contained_recovery` is derived, not self-reported.** Any `error` or `pipeline_defect` in a stage
  marks it, because a stage that spent its time debugging is the one an agent is least likely to
  remember to flag. `timing.stages_with_recovery` lists them, so a clean run and a thrash are
  distinguishable instead of both reading as "this is what the stage costs".

The rollup's `timing.agentic_ms` vs `timing.deterministic_ms` (and `agentic_share`) is the number
that shows whether moving work into deterministic code is paying off. `agentic_share` is `null` when
nothing was metered rather than `0`, which would falsely read as a fully deterministic run.

### Collecting `operator_acceptance`

At the finish handoff, ask the operator one plain question: does the migrated result look
right to them — `accepted`, `rework_needed`, or `rejected`? Record their answer in
`finalize`. If the run never reaches finish or they do not answer, it stays `unknown`.
This is the only field separating "completed and good" from "completed and unusable" —
ask it, but never pressure or interpret; their verdict as given, coarse by design.

## Event taxonomy — when to record what

Events are folded per problem class by the recorder (same type + stage + entity type +
API surfaces + app + error code + subtype fold into one event with a `count`), so record
every occurrence class once and pass `count` when you observed many at once — e.g. a
generated script reporting 4,000 identical write failures is **one** `record` call with
`"count": 4000`. Distinct problems are distinct subtypes or error codes, not bigger
counts.

Every event needs: `event_type`, `stage` (defaults to the open stage), `skill` (the
active `rp-*` resource, e.g. `"rp-mapper"`), `severity` (`blocking` | `degraded` |
`cosmetic` | `info`), and `what_happened`. Add `entity_type`, `wix_api_surface` (e.g.
`stores/v3`), `source_api_surface` (endpoint class like `wp/v2/posts` — never a URL),
`wix_app_id`, and `error_code` whenever they apply — they are the cross-run group-by keys.

1. **`halt_needs_user`** — the run stopped at a defined needs-user state. Prefer the
   mechanical form — `wait start --halt <subtype> …` emits it for you (lifecycle step 3);
   record it yourself only for a halt with no wait interval. `subtype`: `missing_input`
   (missing/invalid required input or credential) | `manual_only` (genuinely manual step,
   no API) | `systemic_failure` (systemic failure or data-loss risk).

2. **`manual_action_required`** — the execution plan flagged something as "can't be done,
   needs manual action" (e.g. a storage-plan upgrade), whether or not the run halted on
   it. `subtype`: `plan_or_billing` | `dashboard_only` | `external_dependency` | `other`.

3. **`error`** — an API or script error, including recovered ones. Carry `error_code`
   (required — it is the discriminator; no subtype), `retry_count`, and `recovered`.
   Record **one event per resolved retry chain**, after the outcome is known — the final
   `recovered`, the total `retry_count` — never one call per attempt (per-attempt calls
   fold into one class, and the failing first attempt's fields would bury the recovery).
   When recovery required a *change* (not just a retry), `actual` must record **what
   change made it succeed**, as an observation: "retried with the description as plain
   text instead of HTML; the write succeeded" — never "the fix is X". If that change
   deviated from the documented path — including a change to a *planned command or
   value*, like simplifying an input the plan specified — also emit a paired
   `skill_coverage_gap` (`undocumented_workaround`).

4. **`fidelity_loss`** — the migration technically proceeded but lost something.
   `subtype`: `dropped_field` | `unverified_enum` | `no_target` (source entity with no
   clean Wix target) | `coerced_value`. For a loss triggered by specific records, inline
   the offending record's **sanitized shape** in `observed_shapes` — field names and
   types and which field was dropped/coerced, never values.

5. **`api_gap`** — a missing or insufficient Wix API capability. `subtype`:
   `missing_api` | `missing_capability` (API exists but cannot express the operation) |
   `internal_only` (capability exists but is not publicly exposed) | `other`. Carry
   `wix_api_surface` (required) and `error_code` — that signature is matched centrally
   across runs. **Never write to any backlog file; the event is the whole per-run
   obligation.**

6. **`skill_coverage_gap`** — **the standing self-report, and the highest-value signal
   for improving the skills.** Whenever you act beyond what the active skill explicitly
   told you to do — you guess a value, work around a missing instruction, resolve an
   ambiguity by judgment, or handle a case the skill does not cover — record it **at that
   moment**. `subtype`: `guessed_value` | `undocumented_workaround` |
   `ambiguous_instruction` | `path_not_covered`. Describe the situation and the action
   taken as an observation: "skill did not specify which enum value maps to X, so a value
   was chosen to proceed" — never "the skill should add Y". If you are unsure whether
   something counts as improvisation, it does — record it.

7. **`user_decision`** — the user's answer at every defined checkpoint or fork: the
   mapping-review checkpoint, the approval gate, and intake forks (comments
   anonymization, delivery mode, media reachability, …). `subtype`: `accepted` |
   `declined` | `deferred` | `amended`; `decision_point` (required) names the fork, e.g.
   `mapping_review`, `approval_gate`, `comments_anonymization`. Record the decision, not
   the user's reasoning verbatim. An `amended` acceptance whose change exposed a mapping
   problem additionally surfaces that problem as `fidelity_loss` or
   `skill_coverage_gap`. A `declined` at a terminal checkpoint pairs with
   `terminal_state: abandoned_by_user`.

8. **`pipeline_defect`** — our own migration machinery misbehaved: not a Wix API error,
   not a source failure, not your improvisation. `subtype`: `state_inconsistency` (two
   pipeline state artifacts disagree) | `ordering_violation` (a step ran before its
   prerequisite's output existed) | `record_defect` (a pipeline record/log is malformed
   or misleading as evidence) | `other`. Name the artifacts and their states in
   `what_happened` — names and states, never contents.

### `evidence_refs` — rare, not routine

Author every event to be **self-sufficient**: coded fields + bounded free text +
`observed_shapes` should let a reviewer triage it without opening any artifact. Add
`evidence_refs` (`{"artifact":"execution-log.md","locator":"## Import"}`) only for the
exceptional event whose signal genuinely cannot carry the full observation. Use
project-root-relative paths and prefer section headings as locators (line ranges break
when files regenerate). Never reference secret-bearing config files.

## What never to do

- Never hand-write, edit, or re-read `run-telemetry.json` or `telemetry/` files — the
  recorder appends; you only call it.
- Never record client data values, names, URLs beyond the recorded source origin, or
  secrets — in any field, including shapes and locators.
- Never record a fix, root cause, or recommendation — observations only.
- Never estimate durations — timing comes from `stage`/`wait` boundary calls.
- Never skip a rejected call: fix the listed fields and retry. Rejections are counted
  against telemetry health either way.
- Never create or update improvement/feature-request backlog files during a run — those
  are maintained centrally from many runs' telemetry, not per run.
- Never delete or trim project artifacts for telemetry reasons — capture is a
  non-destructive view; size is not a reason to drop anything.
