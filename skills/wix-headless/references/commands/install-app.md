# Install a Wix app onto a site

Reference for the orchestrator. Invoked from `SKILL.md` Wave 2 once per app entry across the loaded packs' `apps[*]`. Can't be a bash script per-se because the body shape and recovery ladder need to stay frozen in this reference — but the call itself is a plain `curl` against the public Wix admin REST API authenticated with a site-scoped admin token from `@wix/cli`.

## Inputs

- `siteId` — from `wix.config.json`. Passed into the URL via the admin token; also echoed into `tenant.id` in the request body (the apps-installer endpoint expects both).
- `appName` — e.g. `wix-stores`, `wix-forms`, `wix-blog`. Resolved to `appDefId` via `<SKILL_ROOT>/references/commands/known-apps.json`. Unknown name → fail fast (`"Unknown app: {appName}. Known: [list]. Add it to references/commands/known-apps.json before retrying."`); do not guess.

## Call

Wrap in `date -u` captures so timing flows into `run.json.phases[]` as `{ phase: "app-install-{appName}", seconds: <duration> }`.

```bash
TOKEN=$(npx @wix/cli token --site $SITE_ID)
curl -fsSL -X POST 'https://www.wixapis.com/apps-installer-service/v1/app-instance/install' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$(cat <<EOF
{
  "tenant":      { "tenantType": "SITE", "id": "$SITE_ID" },
  "appInstance": { "appDefId": "$APP_DEF_ID", "enabled": true }
}
EOF
)"
```

`$TOKEN` can be reused across every admin call in the same session (it's site-scoped). If the orchestrator already has a token cached in scratch from an earlier app install, skip the re-fetch.

The same body shape as before — `tenant` + `appInstance` — just hand-delivered over HTTPS instead of through the MCP wrapper.

## Strict-then-recover

| Outcome | Action |
|---|---|
| 2xx | Done. |
| 4xx / 5xx with parseable body | Enter recover loop (max 1 retry): search Wix REST docs for `install app instance`, read the top match's method schema, then retry with the discovered shape. |
| Recovery succeeds | Append to `run.json.commandDrift[]`: `{ command: "install-app", primaryError: { status, body }, recoveredWith: { endpoint, bodyPatch }, suggestedFix: "Update references/commands/install-app.md body template" }`. |
| Both paths fail | Surface the original response body and the doc link to the user. Do not loop further. |

## Why this is a reference doc, not a script

The body shape and the strict-then-recover ladder are the parts that need to stay frozen across runs. Encoding them in a markdown reference the orchestrator reads (instead of a slash command the orchestrator dispatches) keeps the source of truth inside the skill and removes the round-trip through a slash-command shim.
