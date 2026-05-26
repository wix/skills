# Authentication

Every Wix API call this skill makes goes through `@wix/cli` + `curl` — no MCP, no SDK. This file documents the auth shape (header layout, token minting, recovery ladder) so individual phase docs don't have to repeat it.

## Prerequisites

- `@wix/cli` resolvable via `npx`. The scaffold installs it project-local, so `npx @wix/cli …` works without a global install.
- An authenticated CLI session. Test with `npx @wix/cli whoami` — exits **0** when logged in (prints the authenticated email + user id), **non-zero** when logged out.

The primary place this check runs is DISCOVERY.md § "Pre-flight" — foreground, before any `AskUserQuestion`. `scaffold.sh` repeats the check defensively for its standalone-invocation path. If the check fails, surface *"You're not logged in to Wix. Run `npx @wix/cli login` and retry."* and stop — do not start an interview or scaffold the project.

## `wix login` is safe from a non-interactive agent

In an agent context (no TTY), `wix login` writes the verification URL and one-time user code as **human-readable prose to stderr** and the process exits **non-zero** once the agent flow concludes. There are no JSON events — scrape the URL and code out of the stderr file.

### How to invoke

`wix login` (or `npx @wix/cli login`) blocks until the human finishes the browser step, so run it with `run_in_background: true` and capture stderr to a file. Tail the stderr file to read the verification URL + user code as soon as they appear — the user needs them immediately, not after the process exits.

The harness `run_in_background` completion notification is the terminal signal that login finished (success or failure — distinguish by exit code and the final stderr content). Do not poll the CLI session by re-running `whoami` in a sleep loop.

## Token minting

```bash
SITE_ID="<siteId>"  # from wix.config.json after scaffold
TOKEN=$(npx @wix/cli token --site "$SITE_ID")
```

- Mints a **site-scoped REST token**. Stable for the duration of a run — cache it in session scratch and reuse on every `curl`. Do not re-mint per call (each mint costs ~3–5 s of CLI startup).
- Use `npx @wix/cli token …` rather than bare `wix token …`. `@wix/cli` may not be globally installed in every harness; `npx` resolves the project-local copy the scaffold produced. The first invocation auto-fetches the CLI (~3–5 s) if missing; subsequent calls are instant.
- The first `--site "$SITE_ID"` invocation in a run is the source of truth for `SITE_ID`. Bind it in session scratch; do not re-derive from `wix.config.json` mid-run.

## REST call shape

Every call against `wixapis.com` uses two headers:

```bash
curl -sS -X POST "https://www.wixapis.com/<endpoint>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "wix-site-id: $SITE_ID" \
  -H "Content-Type: application/json" \
  -d '<body>'
```

- **`Authorization: Bearer $TOKEN`** — the `Bearer` prefix is required. Variants (`Authorization: $TOKEN`, lowercase `bearer`) are not accepted by all endpoints; standardising on `Bearer` avoids the per-endpoint guessing game.
- **`wix-site-id: $SITE_ID`** — required by site-scoped REST families (Stores v3, CMS v2, Blog v3, Forms v4, Categories v1, Apps-Installer v1, etc.). Harmless on the few endpoints that don't read it, so include it on every call by default rather than discovering its absence via a 403.
- **`Content-Type: application/json`** — required on every POST/PATCH body. The CLI token does not set it.

The body is the recipe's documented JSON payload, with `siteId` inlined where the recipe documents it as a field. Wrapper fields from MCP-era recipes (`reason`, `sourceDocUrl`, `siteId` as an outer arg) are not part of the REST shape and drop on the floor.

## Recovery ladder

| Symptom | First response | If it still fails |
|---|---|---|
| `401 Unauthorized` | Re-mint with `npx @wix/cli token --site "$SITE_ID"` and retry the call once. | The CLI session expired — run `wix login` per the stderr-scrape flow above. |
| `403 Forbidden` | Re-mint and retry once. | The token shape is fine but the caller lacks the permission. The two real causes: (a) the relevant app is not installed yet (re-check `apps-installer-service` returned 200 for that app in Setup Step 4a), (b) the resource requires a provisioning step the recipe doesn't run. Surface the response body; do not loop on retries. |
| `404 Not Found` on a documented URL | Re-read the recipe — URL path segments are easy to typo (e.g. `/blog/v3/bulk/draft-posts/create`, **not** `/blog/v3/draft-posts/bulk/create`). | Recipe bug; surface and stop. |

**Do not** spend turns A/B-testing the header shape (Bearer vs no-Bearer, with/without `wix-site-id`). The shape above is the contract; if a single retry with re-minted token doesn't fix it, the issue is upstream and recipe-level debugging will not recover it.

## Account-scoped calls

`npx @wix/cli token` (no flags) mints an **account-scoped** token. `npx @wix/cli token --site "$SITE_ID"` mints a **site-scoped** token. The CLI's `--site` flag is what toggles between the two scopes; there is no separate `--account` flag because omitting `--site` is itself the account-scoped form.

Verified against the production endpoint on 2026-05-24 — the account-scoped token authenticates against `manage.wix.com` endpoints (e.g. `POST /credit-transactions/v1/credit-transactions/get-account-balance`).

```bash
# Account-scoped — for /credit-transactions, /accounts, /subscriptions, etc.
ACCOUNT_TOKEN=$(npx @wix/cli token)

# Site-scoped — for everything site-operating (apps install, products, blog, cms, …)
SITE_TOKEN=$(npx @wix/cli token --site "$SITE_ID")
```

**Do not share tokens across scopes.** Site-operating calls (`wixapis.com/stores/v3/...`, `/blog/v3/...`, `/wix-data/v2/...`) need the **site** token + `wix-site-id` header; using the account token returns `403 SITE_TOKEN_REQUIRED`. Account-level calls (`manage.wix.com/credit-transactions/...`, `/subscriptions/...`) need the **account** token alone — no `wix-site-id` header; using the site token returns `403 ACCOUNT_TOKEN_REQUIRED`.

Today the only account-scoped call in the skill is the Discovery Q3 balance lookup (`DISCOVERY.md` § 2.5.2). If a future phase needs another, mint a fresh account token at the call site (do not cache across the run alongside the site token — keep them in separate scratch slots so misuse is hard).

**Historical note.** Earlier revisions of this file said the CLI did not expose an account-scoped primitive and concluded the balance lookup was unrecoverable. That was a misreading of `wix token --help` — the help output reads `Get a site-scoped access token` against `--site`, implying (correctly) that omitting `--site` returns the default, account-scoped token. The balance lookup was disabled for no good reason for several runs.
