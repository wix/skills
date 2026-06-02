# Discovery

Capture brand + vibe + imagery + the per-vertical intent inferred from the user's prompt, present a slim plan, get approval, write `.wix/site.json`.

Infer as much as possible from the user's opening message; ask only what's genuinely unknown. Target: **~1:30 of discovery** including user think-time, **≤ 80 s** excluding it.

This phase owns the *domain* of discovery only. Run FLOW — when background work is dispatched, what waits on what, batching, and the transition into Setup/Seed — is owned by `references/PLAN.md` (pre-approval, which routes to `PLAN-regular.md` / `PLAN-integration.md`) and `references/BUILD.md` (post-approval).

**This file is the discovery router.** It holds the two things every run does regardless of mode — **Wave 0 mode detection** and the **CLI-auth pre-flight** — then opens the mode-specific discovery file. The actual interview/parse + plan content lives in `DISCOVERY-regular.md` (astro) or `DISCOVERY-integration.md` (custom). Read only the matching one.

## Wave 0 — Mode detection (BEFORE any user-facing question)

Frontend mode is the single axis the frontend track branches on. Detect it from the working directory **first** — before the CLI-auth pre-flight, before Q1 — so the rest of Discovery knows which path to take. The detection is a file-existence check; cost is ~1 ms. The axis is binary: **astro (scaffold mode — the skill writes the site) vs custom (integration mode — the user brought a finished site to connect).**

```
Inspect CWD:

1. CWD is empty (or doesn't exist) → SCAFFOLD MODE (astro).
2. CWD contains `wix.config.json` AND Astro structure (`src/`, `astro.config.mjs`)
   → resume a prior wix-headless run. See SKILL.md § "When NOT to use this skill"
     ("continue or start fresh?" — out of pivot scope).
3. CWD contains a working frontend (`index.html`, `*.html`, `*.jsx`/`*.tsx`/`*.vue`,
   a Claude-Design handoff bundle, etc.) — with or without `wix.config.json`
   → CUSTOM (integration mode): connect the brought-in site to Wix.
```

Capture the resolved value in session scratch as `frontend`:

| Scenario | `frontend` value | Wave 0 next |
|---|---|---|
| Scaffold mode (empty CWD) | `astro` | Pre-flight, then **`DISCOVERY-regular.md`** |
| Prompt names a non-astro frontend, OR an existing working site is detected (case 3) | `custom` | Pre-flight, then **`DISCOVERY-integration.md`** |

> **No `AskUserQuestion` for mode detection.** Mode is detected from the directory, never asked. If the working directory is ambiguous (some source files but unclear), default to `custom` (integration mode) — connecting what's there is the safe interpretation.

`frontend` flows into:
- `init-site-json.mjs --frontend <value>` — records it in `.wix/site.json` (written for **both** modes; the conductor reads it to decide whether to run `wix build` before release — astro builds, custom doesn't).
- `scaffold.sh --frontend astro` — astro only; custom does **not** scaffold (it bootstraps via `npm create @wix/new@latest init` in the integration flow).
- Orchestrator session scratch — every downstream branch reads the scratch value. For `custom`, the frontend track runs the integration flow (`references/custom/INSTRUCTIONS.md`); the astro-only project-prep (`seed-utilities.sh`) and the Designer/Composer do not run. (Business-track steps — app install, seeders — never read `frontend`.)

## Pre-flight — Verify CLI auth (BEFORE any user-facing question)

The first Wix touch is the post-approval project bootstrap — astro: `scaffold.sh` → `npm create @wix/new@latest headless`; custom: `npm create @wix/new@latest init` — which creates a business + project against the user's Wix account and so requires an active CLI session. Without one it fails — and because the bootstrap runs **after** approval (`BUILD-regular.md` run-step 0 / `BUILD-integration.md` init), a logged-out user wouldn't find out until they'd done discovery *and* approved, only to have it fail immediately. Run the auth check foreground here (both modes) so a logged-out user sees the login prompt first.

```bash
npx @wix/cli@latest whoami >/dev/null 2>&1
```

- Exit 0 → open the matching mode discovery file (astro → `DISCOVERY-regular.md` Step 0; custom → `DISCOVERY-integration.md`).
- Exit non-zero → **run `npx @wix/cli@latest login` yourself; do NOT punt to the user.** Steps:
  1. `Bash` tool with command `npx @wix/cli@latest login`, `run_in_background: true`. No shell `&`, no `mktemp` redirect, no chaining.
  2. Read the harness output-file path from the tool reply's `<bash-stdout>` (or use `TaskOutput`).
  3. Parse line 1 for `{"event":"awaiting_user","userCode":"…","verificationUri":"…"}` (ignore any `TimeoutNaNWarning` on later lines).
  4. Surface in one plain-prose message — *not* `AskUserQuestion`: *"Open `<verificationUri>` in your browser and enter the code `<userCode>` — I'll continue once you've completed the login."*
  5. Wait for the harness `task-notification` with `<status>completed</status>`; confirm with `whoami`, then open the matching mode discovery file.

  Full recovery reference: [`shared/AUTHENTICATION.md`](shared/AUTHENTICATION.md#wix-login-from-a-non-interactive-agent).

## Next — open the mode-specific discovery

With `frontend` resolved and auth confirmed:

- **`astro`** → `DISCOVERY-regular.md` — the interview (Steps 0–2.5) → plan → approval → write `.wix/site.json`.
- **`custom`** → `DISCOVERY-integration.md` — parse the brought-in site → infer domain → light plan → approval → write `.wix/site.json`.

Read only the matching file. The pre-approval funnel (`PLAN-regular.md` / `PLAN-integration.md`) names *when* to apply each discovery step.
