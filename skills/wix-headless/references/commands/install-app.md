# Install a Wix app onto a site

Reference for the orchestrator. Invoked from `SKILL.md` Step 2 once per app entry across the loaded packs' `apps[*]`. Can't be a bash script — the install goes through the Wix MCP tool `CallWixSiteAPI`, not over the wire from the local shell.

## Inputs

- `siteId` — from `wix.config.json`.
- `appName` — e.g. `wix-stores`, `wix-forms`, `wix-blog`. Resolved to `appDefId` via `<SKILL_ROOT>/references/commands/known-apps.json`. Unknown name → fail fast (`"Unknown app: {appName}. Known: [list]. Add it to references/commands/known-apps.json before retrying."`); do not guess.
- `mcpPrefix` — captured in Step 0 (the discovered Wix MCP prefix; see `<SKILL_ROOT>/references/shared/MCP_PREFIX.md`).

## Call

Wrap in `date -u` captures so timing flows into `run.json.phases[]` as `{ phase: "app-install-{appName}", seconds: <duration> }`.

```
{mcpPrefix}CallWixSiteAPI
  siteId:    {siteId}
  url:       https://www.wixapis.com/apps-installer-service/v1/app-instance/install
  method:    POST
  body:      (a JSON object — NOT a string)
             {
               "tenant":      { "tenantType": "SITE", "id": "{siteId}" },
               "appInstance": { "appDefId": "{appDefId}", "enabled": true }
             }
  reason:    Install {appName} on the new headless site
  sourceDocUrl: https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/install-wix-apps
```

The MCP tool requires explicit `url` / `method` / `body` / `reason` / `sourceDocUrl`. Do NOT pass `endpoint:`. Do NOT stringify `body` — pass it as a JSON object. (The Step 0 MCP bootstrap — see `<SKILL_ROOT>/references/commands/mcp-bootstrap.md` — preloads the `CallWixSiteAPI` schema so the orchestrator and subagents both see the right shape.)

## Strict-then-recover

| Outcome | Action |
|---|---|
| 2xx | Done. |
| 4xx / 5xx with parseable body | Enter recover loop (max 1 retry): `{mcpPrefix}SearchWixRESTDocumentation` for `install app instance`, then `{mcpPrefix}ReadFullDocsMethodSchema` on the top match, then retry with the discovered shape. |
| Recovery succeeds | Append to `run.json.commandDrift[]`: `{ command: "install-app", primaryError: { status, body }, recoveredWith: { endpoint, bodyPatch }, suggestedFix: "Update references/commands/install-app.md body template" }`. |
| Both paths fail | Surface the original response body and the doc link to the user. Do not loop further. |

## Why this is a reference doc, not a script

The body shape and the strict-then-recover ladder are the parts that need to stay frozen across runs. Encoding them in a markdown reference the orchestrator reads (instead of a slash command the orchestrator dispatches) keeps the source of truth inside the skill and removes the round-trip through a slash-command shim.
