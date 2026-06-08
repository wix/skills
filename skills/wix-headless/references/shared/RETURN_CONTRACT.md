# Agent Return Contract

Coordination between agents uses **in-memory structured returns**, not sidecar files (`.wix/logs/*.md`, `.wix/seed-returns/*.json`, `.wix/image-urls.md`). Every agent returns a JSON block at the end of its completion message; the skill parses these returns directly from session context.

The orchestrator consumes each return directly from context; nothing is aggregated to disk. The one end-of-run file is the project-root `AGENTS.md` (see `references/shared/AGENTS_MD.md`) — content about the site, not telemetry.

This document is the **universal envelope** every agent shares: the rules, the JSON skeleton, status semantics, and the generic failure shape. **The phase-specific `data` shape you must emit does NOT live here — it lives in your own role doc** (the one your scope already reads). See the index at the bottom.

## The JSON return is your sole output channel

Subagents MUST NOT write coordination files (`.wix/seed-returns/<pack>.json`, `.wix/image-urls.md`, `.wix/logs/*.md`, etc.). The orchestrator parses your fenced JSON block from the message body and either acts on the data directly or pipes it to a deterministic helper script via stdin (e.g. `emit-design-tokens.mjs`, `patch-decorative-slots.mjs`). Any data the orchestrator needs from you belongs under `data` in the return block — files in `.wix/` that aren't build-consumed (CSS, .d.ts) or external-system-owned (`wix.config.json`) are not part of the contract.

## Why structured returns, not files

Writing markdown files between agents assumes they're independent processes without shared memory. But subagents run as child model calls under the parent skill's context — they can return structured data directly. File-based coordination adds:

- ~10s per sidecar write (file I/O + narration)
- ~5s per sidecar read from the parent (another tool call)
- Coordination complexity (timing, status-line parsing, retry logic)

That overhead is pure critical-path cost with no benefit here.

## The contract

Every subagent's final message ends with a fenced JSON block (language tag: `json` or `jsonc`). Format:

~~~markdown
... agent's human-readable summary ...

```json
{
  "status": "complete" | "partial" | "failed",
  "phase": "<phase identifier — see your role doc's Returns section for the exact value>",
  "scope": "<scope string from the agent's prompt>",
  "summary": "<one-line description of what was done>",
  "data": { ... phase-specific structured data — shape defined in your role doc ... },
  "files": ["list", "of", "files", "written", "or", "modified"],
  "errors": [],
  "notes": "<optional — anything the parent skill should know>"
}
```
~~~

The JSON block MUST be the **last** content in the message. The parent skill parses the last fenced JSON block as the return.

### Timing is NOT the agent's responsibility

Agents don't self-report timing or status — the return is just `data`. Emit no `started`/`ended` timestamps; any wall-clock measurement is the harness's job, taken from the session trace.

### No trailing prose after the fenced JSON

The fenced JSON block must be the **last** content in the message. A trailing sentence — or no block at all — means the parent skill has to reconstruct `data.products` etc. from narrative text. That's fragile, and when a later phase relies on pre-seeded data from earlier returns, a missing block means downstream agents don't get their data inline and fall back to re-querying the REST API, costing 5–15s each.

**Correct pattern — end with the fenced block, no trailing prose:**

~~~markdown
✅ CORRECT

All files written. Contract classes referenced: productCard, productGrid, optionPill, quantityBtn.

```json
{
  "status": "complete",
  "phase": "stores-components",
  "scope": "components",
  "summary": "Wrote React islands + utils; contract classes referenced: 11",
  "data": { ... },
  "files": [ ... ],
  "errors": []
}
```
~~~

~~~markdown
❌ WRONG — trailing prose after the block

```json
{ "status": "complete", ... }
```

All three files are correctly written. Let me verify the key requirements are met before returning.
~~~

The parent skill looks for the **last** fenced JSON block in the message. A trailing sentence means it's no longer the last content; scanning falls back to heuristics. Just stop writing after the closing ` ``` `.

## Status semantics

| Status | Meaning | Parent action |
|--------|---------|---------------|
| `complete` | All work done successfully | Proceed to next phase |
| `partial` | Some work done, some failed — `errors` explains | Decide per-case: retry, work around, or fail the run |
| `failed` | Nothing usable produced — `errors` explains | Retry with corrective prompt or fail the run |

## Failure returns

On `failed` or `partial`, `errors` is populated and `data` may still contain partial results:

```json
{
  "status": "partial",
  "phase": "stores-pages-products",
  "errors": [
    {
      "file": "src/pages/products/[slug].astro",
      "code": "MISSING_SEO_DATA",
      "message": "product.seoData was null; fell back to product.name for <title>",
      "severity": "warning"
    }
  ],
  "data": {...}
}
```

Severity levels: `warning` (keep running), `error` (parent should retry), `fatal` (parent must stop).

## Where your phase-specific `data` shape lives

The envelope above is universal. The exact `data` shape — plus the known `error.code` values and required `files` — lives in **your role doc**, the one your scope already reads. Do not look for them here; read your own doc. This keeps each shape single-sourced (no drift) and means you never load shapes for phases you don't emit.

| Your agent / scope | `phase` value(s) | Shape lives in |
|---|---|---|
| Seed — stores | `stores-seed` | `references/stores/INSTRUCTIONS.md` § Seed return |
| Seed — CMS | `cms-seed` | `references/cms/INSTRUCTIONS.md` § Seed return |
| Seed — other verticals | `<pack>-seed` | per-vertical `INSTRUCTIONS.md` (same generic shape as stores) |
| Components | `<pack>-components` | `references/shared/IMPLEMENTER.md` § Return contract |
| Pages | `<pack>-pages[-<group>]` | `references/shared/IMPLEMENTER.md` § Return contract |
| Design System Designer | `design-system` | `references/DESIGN_SYSTEM.md` § What you write and return |
| Design System Composer (`scripts/compose.mjs`, not a subagent — manifest printed to stdout) | `compose` | `scripts/compose.mjs` header (the manifest shape) |
| Page Designer | `designer-<scope>` | `references/astro/designer/INSTRUCTIONS.md` (per-scope) |
| Images | `image-phase-1-decorative`, `image-phase-2-entity` | `references/images/INSTRUCTIONS.md` § Return Contract |

The **orchestrator** is the one audience that needs every shape — it parses each return directly; there is no aggregated file. This table is its index.

## Notes for agent authors

When writing a new agent, put a **Returns** section in its role doc (`INSTRUCTIONS.md` or equivalent) listing:

1. The `phase` identifier this agent emits
2. The exact `data` shape for successful returns
3. Known `error.code` values
4. Required `files` entries

Then add a row to the index table above so the orchestrator can find it. Do **not** copy the shape back into this file — one source per shape. Produce the JSON return block deterministically; don't let creative prose overrun the fenced block. Parent skill parsing assumes the JSON is well-formed and complete and is the **last** content in the message.
