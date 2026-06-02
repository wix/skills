# Discovery

Capture brand + vibe + imagery + the per-vertical intent inferred from the user's prompt, present a slim plan, get approval, write `.wix/site.json`.

Infer as much as possible from the user's opening message; ask only what's genuinely unknown. Target: **~1:30 of discovery** including user think-time, **≤ 80 s** excluding it.

This phase owns the *domain* of discovery only. Run FLOW — when background work is dispatched, what waits on what, batching, and the transition into Setup/Seed — is owned by `references/PLAN.md` (pre-approval, which routes on **operation** to `PLAN-create.md` / `PLAN-connect.md`) and `references/BUILD.md` (post-approval, which routes on **framework**).

**This file is the discovery router, and it routes on OPERATION.** It holds the two things every run does regardless of operation — **Wave 0 field resolution** and the **CLI-auth pre-flight** — then opens the operation-specific discovery file. The actual interview/parse + plan content lives in `DISCOVERY-create.md` (create) or `DISCOVERY-connect.md` (connect). Read only the matching one.

## Wave 0 — Resolve `operation`, then `frontend` (BEFORE any user-facing question)

Discovery routes on **operation** — *create* (the skill writes a new site from a prompt) vs *connect* (the user brings a finished design to wire to Wix). Resolve `operation` **first** from the user's prompt AND the working directory, then derive `frontend` (and `frontendBuild`) *within* that operation. Today the mapping is trivial — create ⇒ astro, connect ⇒ custom — but resolving operation first is the seam: it lets *create + framework-keyword* and *connect + SPA* become expressible without touching the operation router (see the framework-SPA plan, the extend plan).

> **Intent is primary; the directory only confirms.** The bug to avoid: an *empty* CWD does **not** automatically mean create. If the prompt brings a design to connect — even one that will be **fetched into the empty dir** — it's connect. Read the prompt first.

```
Read the prompt, then inspect CWD — resolve OPERATION:

1. CONNECT/IMPLEMENT-AN-EXISTING-DESIGN intent in the prompt → operation: connect,
   EVEN IF THE CWD IS EMPTY. Signals: "connect this to wix", "implement this design",
   "host/deploy this site", "this is a working site", or a design-file URL to fetch +
   implement (Claude Design / v0 / Lovable / any tool). The design arrives by fetch into
   the empty dir — emptiness at check time does not make it create.
2. CWD already contains a working frontend (`index.html`, `*.html`, `*.jsx`/`*.tsx`/`*.vue`,
   a design-handoff bundle) → operation: connect — connect the brought-in site.
3. CWD contains `wix.config.json` → an existing wix-headless project (resume/extend; see
   SKILL.md § "When NOT to use this skill" — out of pivot scope for now; the extend plan
   adds `operation: extend` here, ahead of the emptiness tests).
4. Otherwise — empty CWD AND a CREATE-A-NEW-SITE prompt ("build me a store", "I want to
   sell tables online", "make a blog") with no design to connect → operation: create.
```

Then derive `frontend` and `frontendBuild` **within** the chosen operation, and capture all three in session scratch (the Plan→Build contract core, `PLAN.md` § "The Plan→Build contract"):

| `operation` | `frontend` (today) | `frontendBuild` (today) | Wave 0 next |
|---|---|---|---|
| `connect` — connect/implement an existing design, OR a working site on disk | `custom` | `none` | Pre-flight, then **`DISCOVERY-connect.md`** |
| `create` — create a new site from a prompt, empty CWD, nothing to connect | `astro` | `wix` | Pre-flight, then **`DISCOVERY-create.md`** |

> **No `AskUserQuestion` for operation/frontend detection.** They are inferred from the prompt + directory, never asked. When intent is unclear, default to `operation: connect` — connecting/implementing what the user brings is the safe interpretation; creating a brand-new site over their intent is the destructive one. **A prompt that fetches or names a design to "connect"/"implement" is `connect` regardless of whether the CWD is empty.**

These flow into:
- `init-site-json.mjs --frontend <value>` — records **only** `frontend` in `.wix/site.json` (written for **both** operations). `operation` and `frontendBuild` are **NOT** persisted — they live in orchestrator scratch as the in-agent contract (`PLAN.md` § "The Plan→Build contract"). The conductor reads `frontendBuild` from scratch to decide whether to run `wix build` before release — `wix` builds, `none` doesn't.
- `scaffold.sh --frontend astro` — create/astro only; connect does **not** scaffold (it bootstraps via `npm create @wix/new@latest init` in the connect flow).
- Orchestrator session scratch — every downstream branch reads the scratch values. For `connect`, the frontend track runs the connect flow (`references/custom/INSTRUCTIONS.md`); the create-only project-prep (`seed-utilities.sh`) and the Designer/Composer do not run. (Business-track steps — app install, seeders — never read these fields.)

## Pre-flight — Verify CLI auth (BEFORE any user-facing question)

The first Wix touch is the post-approval project bootstrap — create/astro: `scaffold.sh` → `npm create @wix/new@latest headless`; connect: `npm create @wix/new@latest init` — which creates a business + project against the user's Wix account and so requires an active CLI session. Without one it fails — and because the bootstrap runs **after** approval (`BUILD-astro.md` run-step 0 / the connect bootstrap cell, `BUILD.md` § "Bootstrap cell"), a logged-out user wouldn't find out until they'd done discovery *and* approved, only to have it fail immediately. Run the auth check foreground here (both operations) so a logged-out user sees the login prompt first.

```bash
npx @wix/cli@latest whoami >/dev/null 2>&1
```

- Exit 0 → open the matching operation discovery file (create → `DISCOVERY-create.md` Step 0; connect → `DISCOVERY-connect.md`).
- Exit non-zero → **run `npx @wix/cli@latest login` yourself; do NOT punt to the user.** Steps:
  1. `Bash` tool with command `npx @wix/cli@latest login`, `run_in_background: true`. No shell `&`, no `mktemp` redirect, no chaining.
  2. Read the harness output-file path from the tool reply's `<bash-stdout>` (or use `TaskOutput`).
  3. Parse line 1 for `{"event":"awaiting_user","userCode":"…","verificationUri":"…"}` (ignore any `TimeoutNaNWarning` on later lines).
  4. Surface in one plain-prose message — *not* `AskUserQuestion`: *"Open `<verificationUri>` in your browser and enter the code `<userCode>` — I'll continue once you've completed the login."*
  5. Wait for the harness `task-notification` with `<status>completed</status>`; confirm with `whoami`, then open the matching operation discovery file.

  Full recovery reference: [`shared/AUTHENTICATION.md`](shared/AUTHENTICATION.md#wix-login-from-a-non-interactive-agent).

## Next — open the operation-specific discovery

With `operation` (and the derived `frontend`/`frontendBuild`) resolved and auth confirmed:

- **`create`** → `DISCOVERY-create.md` — the interview (Steps 0–2.5) → plan → approval → write `.wix/site.json`.
- **`connect`** → `DISCOVERY-connect.md` — parse the brought-in site → infer domain → light plan → approval → write `.wix/site.json`.

Read only the matching file. The pre-approval funnel (`PLAN-create.md` / `PLAN-connect.md`) names *when* to apply each discovery step.
