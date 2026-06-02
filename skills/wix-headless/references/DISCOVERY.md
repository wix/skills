# Discovery

Capture brand + vibe + imagery + the per-vertical intent inferred from the user's prompt, present a slim plan, get approval, write `.wix/site.json`.

Infer as much as possible from the user's opening message; ask only what's genuinely unknown. Target: **~1:30 of discovery** including user think-time, **≤ 80 s** excluding it.

This phase owns the *domain* of discovery only. Run FLOW — when background work is dispatched, what waits on what, batching, and the transition into Setup/Seed — is owned by `references/PLAN.md` (pre-approval, which routes to `PLAN-regular.md` / `PLAN-integration.md`) and `references/BUILD.md` (post-approval).

**This file is the discovery router.** It holds the two things every run does regardless of mode — **Wave 0 mode detection** and the **CLI-auth pre-flight** — then opens the mode-specific discovery file. The actual interview/parse + plan content lives in `DISCOVERY-regular.md` (astro) or `DISCOVERY-integration.md` (custom). Read only the matching one.

## Wave 0 — Mode detection (BEFORE any user-facing question)

Frontend mode is the single axis the frontend track branches on. Detect it from **the user's prompt AND the working directory** — before the CLI-auth pre-flight, before Q1 — so the rest of Discovery knows which path to take. The axis is binary: **astro (scaffold mode — the skill writes the site from a prompt) vs custom (integration mode — the user brings a finished design to connect).**

> **Intent is primary; the directory only confirms.** The bug to avoid: an *empty* CWD does **not** automatically mean scaffold. If the prompt brings a design to connect — even one that will be **fetched into the empty dir** — it's integration. Read the prompt first.

```
Read the prompt, then inspect CWD:

1. CONNECT/IMPLEMENT-AN-EXISTING-DESIGN intent in the prompt → CUSTOM (integration mode),
   EVEN IF THE CWD IS EMPTY. Signals: "connect this to wix", "implement this design",
   "host/deploy this site", "this is a working site", or a design-file URL to fetch +
   implement (Claude Design / v0 / Lovable / any tool). The design arrives by fetch into
   the empty dir — emptiness at check time does not make it scaffold.
2. CWD already contains a working frontend (`index.html`, `*.html`, `*.jsx`/`*.tsx`/`*.vue`,
   a design-handoff bundle) → CUSTOM (integration mode): connect the brought-in site.
3. CWD contains `wix.config.json` → an existing wix-headless project (resume/extend; see
   SKILL.md § "When NOT to use this skill" — out of pivot scope for now).
4. Otherwise — empty CWD AND a CREATE-A-NEW-SITE prompt ("build me a store", "I want to
   sell tables online", "make a blog") with no design to connect → SCAFFOLD MODE (astro).
```

Capture the resolved value in session scratch as `frontend`:

| Scenario | `frontend` value | Wave 0 next |
|---|---|---|
| Connect/implement an existing design (prompt intent), OR a working site on disk | `custom` | Pre-flight, then **`DISCOVERY-integration.md`** |
| Create a new site from a prompt, empty CWD, nothing to connect | `astro` | Pre-flight, then **`DISCOVERY-regular.md`** |

> **No `AskUserQuestion` for mode detection.** Mode is inferred from the prompt + directory, never asked. When intent is unclear, default to `custom` (integration) — connecting/implementing what the user brings is the safe interpretation; scaffolding a brand-new site over their intent is the destructive one. **A prompt that fetches or names a design to "connect"/"implement" is `custom` regardless of whether the CWD is empty.**

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
