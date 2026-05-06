# Pre-load Wix MCP tool schemas (Step 0)

Reference for the orchestrator. Mandatory in Step 0 of the build flow, after the `WixREADME` connectivity probe and before any other Wix MCP call. Loads every Wix MCP tool schema the orchestrator and downstream subagents will use this session, so calls succeed on the first attempt instead of failing once with a schema-validation error and recovering.

## Why this is encoded as a reference doc

The orchestrator skim-reads SETUP.md and can miss dispatch-time footnotes. Without bootstrap, the first `CallWixSiteAPI` (e.g. install Wix Stores) emits `body` as a JSON string because the schema isn't loaded; the MCP tool returns `Expected object, received string`; the orchestrator ToolSearches mid-flow and retries. Pinning the schema-load list here (rather than as a footnote in SETUP.md) makes the step impossible to skip.

## Run

A single `ToolSearch` call. The query lists every Wix MCP tool likely to be invoked from the orchestrator or any subagent during the build:

```
ToolSearch query: "select:WixREADME,CallWixSiteAPI,SearchWixRESTDocumentation,ReadFullDocsArticle,ReadFullDocsMethodSchema,SearchWixCLIDocumentation,SearchWixSDKDocumentation,SearchWixHeadlessDocumentation,SearchWixWDSDocumentation,SearchBuildAppsDocumentation,BrowseWixRESTDocsMenu"
```

The schemas all become callable for the rest of the session. Subagents inherit the loaded schemas — no per-agent re-loading is required.

The list is intentionally fixed. Do not edit it dynamically based on the loaded vertical packs; the cost of loading an extra schema is zero, and a fixed list eliminates the "did I skip a schema for this run" failure mode.

## Strict-then-recover

`ToolSearch` itself rarely fails. If it does:

- If the error indicates the Wix MCP server isn't connected (no tools matched any of the names), the connectivity probe in Step 0 should have caught it earlier — surface the error and stop. Tell the user to ensure the Wix MCP server is connected and rerun.
- For any other `ToolSearch` error, surface verbatim. Do not retry — there is no retryable failure mode for schema loading.

Append timing to `.wix/run.json.phases[]` as `{ phase: "mcp-bootstrap", seconds: <duration> }`. The duration is typically <1 s; record it anyway so any future regression in MCP cold-start cost is visible.
