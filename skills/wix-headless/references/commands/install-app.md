# Install a Wix app onto a site

Reference for the orchestrator. Invoked from `SKILL.md` Step 2 once per app entry across the loaded packs' `apps[*]`. Runs as a shell call against the Wix REST API, authenticated with the CLI's site-scoped token.

## Inputs

- `siteId` — from `wix.config.json`.
- `appName` — e.g. `wix-stores`, `wix-forms`, `wix-blog`. Resolved to `appDefId` via `<SKILL_ROOT>/references/commands/known-apps.json`. Unknown name → fail fast (`"Unknown app: {appName}. Known: [list]. Add it to references/commands/known-apps.json before retrying."`); do not guess.

## Call

Wrap in `date -u` captures so timing flows into `run.json.phases[]` as `{ phase: "app-install-{appName}", seconds: <duration> }`.

```bash
SITE_ID="{siteId}"
TOKEN=$(wix token --site "$SITE_ID")

curl -sS -X POST "https://www.wixapis.com/apps-installer-service/v1/app-instance/install" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant":      { "tenantType": "SITE", "id": "'"$SITE_ID"'" },
    "appInstance": { "appDefId": "{appDefId}", "enabled": true }
  }'
```

Reference doc URL the body shape is taken from: `https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/install-wix-apps`.

The site-scoped CLI token encodes the site, so no separate `wix-site-id` header is needed.

## Strict-then-recover

| Outcome | Action |
|---|---|
| 2xx | Done. |
| 4xx / 5xx with parseable body | Enter recover loop (max 1 retry): if the Wix MCP doc tools are connected, use `SearchWixRESTDocumentation` for `install app instance` then `ReadFullDocsMethodSchema` on the top match and retry with the discovered shape. Otherwise, surface the response body verbatim and ask the user. |
| Recovery succeeds | Append to `run.json.commandDrift[]`: `{ command: "install-app", primaryError: { status, body }, recoveredWith: { endpoint, bodyPatch }, suggestedFix: "Update references/commands/install-app.md body template" }`. |
| Both paths fail | Surface the original response body and the doc link to the user. Do not loop further. |

## Why this is a reference doc, not a script

The body shape and the strict-then-recover ladder are the parts that need to stay frozen across runs. Encoding them in a markdown reference the orchestrator reads (instead of a slash command the orchestrator dispatches) keeps the source of truth inside the skill and removes the round-trip through a slash-command shim.
