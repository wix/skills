# Setup

Runs once per session, immediately after plan approval. Verifies CLI auth, installs apps, pulls env, kicks off npm install in background, writes memory, creates the user-facing roadmap.

Target: **~15 seconds on the critical path** (everything after the Wave 0 auth check runs as a single concurrent batch).

---

## Step 0 — CLI auth verification (first time only)

Runs once per session, before any admin REST call. Separate from the Setup step because it gates the whole flow: a missing/expired CLI session means every downstream `curl` will 401.

1. **Confirm the auth file is on disk** — `ls ~/.wix/auth/account.json` exists and is non-empty.
2. **Confirm the session is live** — `npx @wix/cli whoami` exits 0.
3. If either check fails → stop and tell the user: `"Run `npx @wix/cli login` and retry."`
4. Once `siteId` is known (after scaffold lands later in Wave 2), fetch the session admin token: `TOKEN=$(npx @wix/cli token --site $SITE_ID)`. Hold `$TOKEN` in scratch for the rest of the session and reuse it for every admin REST call. Subagents receive `siteId` in their prompt and fetch their own token the same way.

See `references/shared/REST_CONVENTIONS.md` for the full call shape (base URL, headers, body) every admin call follows.

> **Why CLI auth is the gate.** Every admin call in the skill is `curl -H "Authorization: Bearer $TOKEN"`; without a valid token, the first app install returns 401 and the flow stalls. Verifying upfront and surfacing a single actionable error message ("run `wix login`") prevents a partially scaffolded project.

---

## Setup Dispatch — one concurrent batch

> **BATCHING — read this twice before proceeding.**
>
> Launch every operation below as a single concurrent batch. No narration, no *"Now setting up:"*, no transition text between dispatches.
>
> Any text adjacent to a dispatch closes the batch and forces remaining operations into separate turns. An earlier run lost 13s to roadmap-tracker calls splitting across 13 turns; an earlier run lost ~50 minutes to an npm install recovery gate. Both are eliminated by strict single-batch dispatch here.

### Contents of the setup dispatch

The skill assembles this dispatch dynamically from the loaded vertical packs. The items below list what to emit.

#### 1. Verify scaffold completed

**Before the setup dispatch:** read `<project>/wix.config.json` to confirm the background scaffold from Discovery Step 1 finished. If not, wait for the background scaffold to finish. On scaffold failure, retry the inline `npm create @wix/new` call once (same shell command from DISCOVERY.md Step 1); surface the error if it still fails. Recovery ladder is documented in DISCOVERY.md § "Strict-then-recover" — auth, invalid template, etc.

Once `wix.config.json` exists, extract `siteId` (value of the `siteId` field — this is the businessId every admin REST call in the session is scoped against, and the input to `npx @wix/cli token --site $SITE_ID`).

`cd` into the project directory so all subsequent file operations and shell commands are relative to it.

#### 2. The dispatch itself (one concurrent batch)

**App installs** — one `curl` per app in the union of loaded packs' `apps[*]`. Example for an ecommerce run (stores pack contributes one app; cms pack contributes none):

```bash
TOKEN=$(npx @wix/cli token --site $SITE_ID)
curl -fsSL -X POST 'https://www.wixapis.com/apps-installer-service/v1/app-instance/install' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$(cat <<EOF
{
  "tenant":      { "tenantType": "SITE", "id": "$SITE_ID" },
  "appInstance": { "appDefId": "<pack.apps[0].appDefId>", "enabled": true }
}
EOF
)"
```

See `references/commands/install-app.md` for the full recipe (app-name resolution, recovery ladder) and `references/shared/REST_CONVENTIONS.md` for the auth pattern.

A 200 response with `"enabled": true` confirms success.

**Packs with `apps: []` (e.g. `cms`)** — record a phase entry in `run.json` anyway: `{phase: "app-install-<pack>", status: "skipped", notes: "Bundled with Wix platform; no install required"}`. Without an explicit skipped entry, `run.json` reads as a silent omission ("did the CMS install run? was it skipped? did it fail?"); the explicit entry makes observability unambiguous.

**Namespace propagation:** After app install, the app's API namespace may take up to 30 seconds to register. If a downstream REST call fails with `UNSUPPORTED_FORM_NAMESPACE`, wait 10 seconds and retry up to 3 times. Phase 1 Seeders handle this retry themselves.

**Shell: `npx @wix/cli env pull`** (foreground, ~5s). Writes `WIX_CLIENT_ID` to `.env.local`. Idempotent. Skipping this historically caused `Missing environment variable WIX_CLIENT_ID` build failures.

**Background shell: `npm install ...`**:

The package list is the union of:
- Always: `@wix/sdk tailwindcss @tailwindcss/vite`
- Per loaded pack: each pack's `packages` array

> **Do not add any package beyond this set.** If a pack feels like it should have its own SDK (`@wix/<pack-name>`), confirm by reading its `packages:` array. Passive packs (gift-cards) intentionally declare nothing because they're runtime-detected via REST. There is no `@wix/gift-cards` SDK on npm — adding it on a hunch fails with `npm 404`. Same logic for any other pack: the union above is the install list. Period.

Flags: `--no-fund --no-audit --legacy-peer-deps`. `--legacy-peer-deps` is mandatory (Wix SDK transitive peer conflicts). `--no-fund --no-audit` prevent interactive prompts that hang agent sessions.

Because scaffold runs with `--skip-install`, delete the stale lockfile before installing: `rm -f package-lock.json`.

Example combined command (ecommerce run):
```bash
rm -f package-lock.json && npm install --no-fund --no-audit --legacy-peer-deps \
  @wix/sdk tailwindcss @tailwindcss/vite \
  @wix/stores @wix/ecom @wix/redirects @wix/site \
  @wix/data @wix/essentials
```

Capture the background process's handle (whatever your runtime uses to wait on a long-running shell) for later wait in Step 8 (Build & Preview).

**Memory writes** — two writes:
1. `MEMORY.md` index entry (one line)
2. `project`-type memory file with brand, vertical(s), apps, pages, project path, phase: `scaffolding`

**User-facing roadmap × N** — target 6–8 entries mapped to phase boundaries:

| Entry | Marks completed |
|------|-----------------|
| Scaffold project | Immediately on creation (already done in Discovery) |
| Install apps | Immediately on creation (this dispatch) |
| Seed data | After Phase 1 Seed returns (Step 6) |
| Design site | After Phase 2 Design System returns (Step 4) |
| Generate images | After image subagent returns (may finish later than critical path) |
| Wire features | After Phase 3 Components + Phase 4 Pages return (Step 7/8) |
| Install dependencies | After npm install background shell completes (Step 8) |
| Build and preview | After Step 8 |

> **No ampersands in roadmap titles.** Some progress trackers HTML-escape input — `"Build & preview"` renders as literal `Build &amp; preview`. Spell out "and" (or restructure) to avoid `&`. Same for `<`, `>`, `"` and other HTML-meaningful characters.

> **Avoid the 13-entry sprawl.** Historical runs used one entry per phase-per-feature ("Design page — Home", "Seed stores", "Wire CMS", etc.). Collapse to the phase-boundary list above. Users care about milestones, not sub-phases.

**Shell: `mkdir -p .wix`** — minimal. No `.wix/logs/`.

### Batching verification

After the dispatch, the run log should show ~8–12 operations dispatched as one concurrent batch (varies by pack count). If they spread across multiple turns, the batching guidance failed and the skill needs to be tightened.

---

## npm install recovery

If the background npm install from the Setup dispatch fails or hangs:

1. **Foreground retry with 90-second timeout:**
   ```bash
   npm install --no-fund --no-audit --legacy-peer-deps <packages>
   ```

2. **If still hanging, retry with `--prefer-offline`:**
   ```bash
   npm install --prefer-offline --no-fund --no-audit --legacy-peer-deps <packages>
   ```

3. **If still hanging, clear the cache:**
   ```bash
   npm cache clean --force
   npm install --no-fund --no-audit --legacy-peer-deps <packages>
   ```

4. **Last resort:** tell the user: *"npm install is hanging. Please run `npm install --legacy-peer-deps` manually in your terminal, then let me know when it's done."*

---

## After the Setup Dispatch

Proceed immediately to **Step 3 — Phase 1 Seed + Phase 2 Design System + Image Phase 1** — see `ORCHESTRATION.md`. Do not wait for the background npm install; that's waited on in Step 8.
