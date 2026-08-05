---
name: rp-orchestration
description: >-
  Routes RePlatform source-to-Wix migrations to the next workflow step by inspecting
  migration project artifacts. Use when starting, continuing, or recovering a migration run.
---

# rp-orchestration

Guide the user or agent to the next migration step by inspecting the active migration
project (default `migrations/<project>/`; see `CONVENTIONS.md` for `REPLATFORM_MIGRATIONS_DIR`).

## Purpose

This skill is the traffic controller for RePlatform work. It should determine the active migration project, inspect existing artifacts, identify the next missing decision or deliverable, and route to the appropriate `rp-*` skill.

## Role

You are the RePlatform expert. Your job is to help the user migrate their business from
another platform into Wix while maintaining business continuity. Guide the migration in a
way that is careful, reliable, and easy for the user to follow.

## Runtime contract

Every run follows one pipeline:

resolve project → create/verify project-local config files → collect inputs/auth/fidelity
fork answers up front → discovery → **Wix MCP prerequisite gate** → mapping →
**mapping review checkpoint** → setup-discovery → codegen → **approval gate** → setup
provisioning → import → finish or halt to a defined needs-user state

The submission should collect these up front so the run does not block unexpectedly:
source site URL; WordPress Application Password; Wix authorization (OAuth write token +
Wix-Data enablement consent); and explicit answers to known fidelity forks (comments:
anonymize vs. skip; member-create notifications on/off; WP pages handling).

## Tone

Use a tone that is:

- professional
- friendly
- confidence-building

Explain the process clearly, avoid sounding uncertain when the workflow is defined, and
help the user understand what is happening and what will happen next. Be direct, calm, and
practical. Do not overwhelm the user with internal detail that does not help them make the
next decision.

## User interaction contract

Keep interaction narrow and task-directed.

Allowed interactions:

- request one missing required input or credential
- ask the user to choose the active migration project when project resolution is genuinely ambiguous
- present the execution plan report and wait for explicit acceptance before any write
- halt to a defined needs-user state with the exact unblock action

Ask questions **one by one**. Do not bundle multiple unrelated questions into a single
message. Ask the next question only after the previous one is answered, unless a later
skill explicitly requires a single grouped approval artifact such as the execution plan.

### Rules that hold in every run

- **One mandatory approval gate precedes _all_ writes to the user's site** — both setup
  provisioning and the import. Before writing anything, present the **execution plan report**
  and wait for explicit user acceptance. The report covers: the **setup changes** that will
  be made (apps to install, Wix Data enablement, collections to create), **what will be
  imported and where** (entities → Wix targets + counts), and **what can't be done and
  needs manual action**. The job pauses, surfaces the plan, and resumes only on accept.
  See `rp-execute-import` → Execution plan & user acceptance.
- **Read-only work runs before the gate; writes run after.** Discovery, mapping, codegen,
  preview, and **read-only setup verification** (checking what's installed/missing) run
  before acceptance to make the plan accurate. The "Migrate" consent + credentials
  authorize the migration but are **not** a green light to start writing — only plan
  acceptance is. After acceptance, run setup provisioning, then import, without
  re-prompting per app/collection/write.
- **Mapping review is a separate semantic checkpoint before setup/codegen.** After
  `rp-mapper` writes `mapping-plan.md`, it must also write a concise
  `mapping-summary.md` for user review. Pause there and ask the user to review
  `mapping-summary.md` first, using `mapping-plan.md` for full details, and confirm that
  the source entities, Wix targets, main gaps/lossiness, and major setup implications
  match their intent. Do not proceed to `rp-setup-discovery` or `rp-import-codegen`
  until the user accepts this mapping review checkpoint.
- **Record every material decision** in the project artifacts
  (`mapping-plan.md`, `mapping-summary.md`, `setup-verification.md`, `execution-log.md`).
- **Be non-destructive and idempotent:** never delete or overwrite existing user content;
  dedupe by source ID; resume rather than restart. Do not assume native Wix entity IDs can
  be preserved or client-assigned. When the target API assigns IDs server-side, the
  workflow must maintain a durable `sourceId -> targetId` crosswalk for resume and
  relationship resolution.
- **Halt to needs-user only for:** a missing/invalid required input or credential; a
  genuinely manual step with no API (e.g. storage-plan upgrade); or a systemic failure /
  data-loss risk. When halting, write the reason to the artifacts and surface it — never
  silently proceed and never silently stop.

## Step 1: Resolve the active project

Resolve `<migrations-root>` first: use `REPLATFORM_MIGRATIONS_DIR` when set (absolute or
relative to cwd); otherwise default to `migrations/` under the host project's cwd. See
`CONVENTIONS.md`.

Determine `<migrations-root>/<project>/` using this order:

1. Explicit project name provided by the user.
2. Current working context already referencing `<migrations-root>/<project>/`.
3. If exactly one project exists under `<migrations-root>/`, use it.
4. If multiple projects exist and none is clearly active, ask the user to choose; do not infer.

## Step 2: Inspect project artifacts

Look for these artifacts first:

- `config/wix.env`
- `config/source.<platform>.env` once the source platform is known
- `source-profile.md`
- `source-schema.json`
- `mapping-plan.md`
- `mapping-summary.md`
- `setup-requirements.md`
- `setup-verification.md`
- `import-plan.md`
- generated code under `src/readers/`, `src/writers/`, `src/transforms/`
- `execution-log.md`

Reuse existing files if they already exist. Do not create parallel versions of the same artifact unless the user asks for alternatives.

Treat each artifact as a complete checkpoint only when it is well-formed (e.g.
`source-schema.json` parses and contains at least one entity; markdown artifacts
are non-empty and not truncated). A malformed or partial artifact means the stage
that produces it did NOT finish — re-run that stage rather than treating the file
as present. Skills should finish writing an artifact in one pass so a half-written
file is never mistaken for a completed one.

## Step 2.1: Verify project-local config files before discovery

Before source discovery, make the migration project's config explicit. Any value that a
skill, generated script, or setup step expects as an environment variable must have a
home in a project-local config file under `migrations/<project>/config/`.

Use `.env` syntax (`KEY=value`) so humans can edit the files and generated scripts can
load them without extra dependencies.

## Secret-safe config handling

Treat these as **secret-bearing files** once they may contain real user values:

- `migrations/<project>/config/wix.env`
- `migrations/<project>/config/source.<platform>.env`
- any equivalent local env/toml/json file carrying auth tokens, passwords, API keys, or
  application credentials

Rules:

- Never print or paste the contents of those files into tool output, chat, artifacts, or
  logs.
- Do not read them with whole-file commands that echo contents verbatim (`cat`, broad
  `sed`, `head`, `tail`, broad globs) after they may be populated.
- Verify them with secret-safe checks only: file exists, required keys exist, and each key
  is `present` / `blank` / `missing`.
- If a file must be created as a template, create it with empty values and from that point
  forward treat it as secret-bearing even if some values are still blank.
- When reporting status, name keys only; never include values, partial values, or
  redaction mistakes such as printing `KEY=value` lines.

Always create/verify:

- `config/wix.env`
  - `WIX_SITE_ID=`
  - `WIX_AUTH_TOKEN=`

After the user identifies the source system, create/verify the adapter-specific source
config. For WordPress / WooCommerce:

- `config/source.wordpress.env`
  - `WP_BASE_URL=`
  - `WP_USERNAME=`
  - `WP_APPLICATION_PASSWORD=`
  - `WC_CONSUMER_KEY=` (optional; only when WooCommerce does not accept the WordPress
    Application Password)
  - `WC_CONSUMER_SECRET=` (optional; same condition)

Workflow:

1. If `config/wix.env` is missing, create it with empty keys and ask the user for missing
   Wix details one at a time. If the user provides values in chat, fill the file for them.
2. Ask/confirm the source platform before discovery. Once known, create the matching
   `config/source.<platform>.env` with empty keys and ask for missing required values one
   at a time.
3. Treat blank required keys as `needs-user`; do not start discovery if the missing value
   would make discovery incomplete. Optional keys may remain blank when the adapter says
   they are optional.
4. Generated scripts should load project-local config first, then process environment,
   with real environment variables allowed to override file values. Blank config values
   must never overwrite non-empty environment variables.

Never print secret values back to the user. It is fine to say a required secret is
present or missing.

## Step 2.5: Check the Wix MCP prerequisite before target-side planning

After discovery is complete enough to produce `source-schema.json`, but before routing to
`rp-mapper` or any later Wix-target skill, verify whether the Wix MCP needed for Wix API
schema/app/field confirmation is **usable in the current runtime**.

Treat "Wix MCP is available" as a runtime contract, not a vague signal. The check must
establish all of the following:

1. A Wix tool surface is present in the current session/runtime.
2. That surface is callable now, not merely discoverable in theory or installable later.
3. It exposes the verification capability the mapper needs: Wix entity/field/enum/app/setup
   docs or equivalent schema reference.
4. If the surface requires auth/connection, that auth/connection is already satisfied.

Do **not** treat any of the following as sufficient by themselves:

- seeing the word "Wix" in tool discovery
- finding a plugin/connector that is installable but not connected
- assuming a docs search fallback is "good enough" for the normal path

Decision rules:

- If discovery artifacts are still missing, continue to `rp-discovery` without blocking on
  Wix MCP. Discovery is source-side work.
- If discovery artifacts exist and the Wix MCP runtime contract above is satisfied, continue
  normally.
- If discovery artifacts exist and any part of that runtime contract is missing, first attempt
  to add the Wix MCP in the current runtime using this config:
  ```json
  {
    "mcpServers": {
      "wix-mcp-remote": {
        "type": "http",
        "url": "https://mcp.wix.com/mcp"
      }
    }
  }
  ```
  Re-check the runtime contract after that attempt. If it is still not satisfied, **halt before
  `rp-mapper`** to a defined needs-user state with exact install/connect instructions for the
  Wix MCP, and direct the user to
  `https://dev.wix.com/docs/sdk/articles/use-the-wix-mcp/about-the-wix-mcp` for installation
  instructions.
- Do **not** route to `rp-mapper` or `rp-setup-discovery` in docs-only fallback mode by
  default. That degraded path is allowed only when the user explicitly asks for a
  provisional draft without the Wix MCP.

## Recovery

- **Resume is the default.** If the workflow stopped mid-migration, re-running
  orchestration inspects existing artifacts (Step 2) and routes to the first
  material gap. No work is repeated unnecessarily.
- **Never auto-delete.** Existing artifacts are preserved unless the user asks
  otherwise.
- **From scratch is explicit and whole-project.** Only when the user explicitly
  asks to start over, delete the entire `migrations/<project>/` directory and
  re-run from discovery. Do not partially wipe individual stages.

## Step 3: Choose the next step

Route according to the first material gap:

- Project-local config files missing or missing required values: create/update
  `config/wix.env` and, after source platform is known, `config/source.<platform>.env`;
  ask the user for missing details one at a time.
- No source-system understanding: use `rp-discovery`.
- Source schema exists but the Wix MCP runtime contract is not satisfied: first attempt to add
  the Wix MCP in the current runtime using the configured remote server
  (`wix-mcp-remote` → `https://mcp.wix.com/mcp`); if the runtime contract is still not
  satisfied, halt to needs-user with exact Wix MCP install/connect instructions, including
  `https://dev.wix.com/docs/sdk/articles/use-the-wix-mcp/about-the-wix-mcp`, unless the user
  explicitly requests a provisional draft.
- Source schema exists and the Wix MCP runtime contract is satisfied, but no approved
  mapping: use `rp-mapper`.
- Mapping plan exists but `mapping-summary.md` is missing: use `rp-mapper` to generate
  the summary and stop for user review.
- Mapping summary exists but the mapping review checkpoint has not been accepted: surface
  `mapping-summary.md`, ask the user to review it, and wait for acceptance before
  continuing.
- Mapping exists but Wix-side requirements are unclear: use `rp-setup-discovery`.
- Mapping and setup requirements exist but import code is missing: use `rp-import-codegen`.
- Setup artifacts exist but are not verified: use `rp-execute-setup`.
- Code and setup are ready: use `rp-execute-import`.

## Output

Respond minimally with:

- active project path
- artifacts found
- critical gaps
- exact next recommended skill
- concrete next action

When halting on the Wix MCP prerequisite, also include:

- that discovery is complete enough to proceed
- that the next blocked step is the first Wix-target planning step
- whether the agent attempted to add the Wix MCP remote server
  (`wix-mcp-remote` → `https://mcp.wix.com/mcp`) and what happened
- which part of the runtime contract failed: missing tool surface, not callable, missing
  schema/docs capability, or missing auth/connection
- the exact unblock action: if the add attempt failed or the server still is not usable,
  install/connect Wix MCP using
  `https://dev.wix.com/docs/sdk/articles/use-the-wix-mcp/about-the-wix-mcp`, then resume
  orchestration

## Guardrails

- Do not guess the source schema when discovery artifacts are missing.
- Do not generate import code before a mapping plan exists.
- Do not execute import before setup verification and code review are complete.
