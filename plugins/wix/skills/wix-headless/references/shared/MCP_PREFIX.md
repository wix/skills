# Wix MCP Tool Prefix — Discovery & Propagation

Wix MCP tools are exposed under one of two prefixes depending on how the user installed the integration:

| Install mode | Prefix |
|---|---|
| **Plugin** (typical for end users) | `mcp__plugin_<plugin-name>_wix-mcp-remote__` (e.g. `mcp__plugin_wix-headless_wix-mcp-remote__WixREADME`) |
| **Direct MCP server** | `mcp__wix-mcp-remote__` (e.g. `mcp__wix-mcp-remote__WixREADME`) |

Tool **suffixes** are identical in both modes: `WixREADME`, `CallWixSiteAPI`, `ListWixSites`, `ManageWixSite`, `SearchWixHeadlessDocumentation`, `SearchWixSDKDocumentation`, `SearchWixRESTDocumentation`, `BrowseWixRESTDocsMenu`, `ReadFullDocsArticle`, `ReadFullDocsMethodSchema`. Only the prefix differs.

Documentation in this plugin uses the canonical short form (`mcp__wix-mcp-remote__<suffix>`) for readability — substitute the discovered prefix at runtime.

---

## Discovery — entry-point skills only, once per session

The entry-point skill (`wix-headless`) MUST run this before any other MCP call:

1. Use whatever tool-discovery primitive your runtime provides to look up `WixREADME`.
2. From the returned tool name, strip the trailing `WixREADME` — what remains (ending in `wix-mcp-remote__`) is the **MCP prefix**. Examples:
   - Returned name `mcp__plugin_wix_wix-mcp-remote__WixREADME` → prefix `mcp__plugin_wix_wix-mcp-remote__`
   - Returned name `mcp__wix-mcp-remote__WixREADME` → prefix `mcp__wix-mcp-remote__`
3. Call `<prefix>WixREADME` once to verify connectivity.
4. **If discovery returns no match, or the verify call fails:** stop and tell the user:
   > *"Wix MCP tools are not available in this session. Please ensure the Wix MCP server is connected (or that the Wix plugin is enabled), then restart your client."*
5. Hold the discovered prefix in working memory for the rest of the session — use it for every MCP call AND pass it into every subagent prompt.

---

## Propagation to subagents

Subagents (every Phase 1 / Phase 2 / Phase 3 / Phase 4 implementer) are isolated workers — they see only the prompt their parent gave them, not the parent's session state. Every subagent prompt MUST include this line verbatim near the top:

```
MCP tool prefix: <discovered prefix>
Use this prefix for every Wix MCP call. Example: <prefix>CallWixSiteAPI, <prefix>WixREADME.
```

Without this line the subagent will try the canonical short form and fail in plugin mode.

---

## `CallWixSiteAPI` call conventions — read before the first call

`CallWixSiteAPI` is the most error-prone tool in this plugin. Two failure modes recur; avoid both:

**1. Missing required wrapper params.** The tool requires — in addition to `method`, `url`, `body` — these wrapper fields:

- `siteId` — from `wix.config.json` (or the parent prompt)
- `reason` — one-sentence human reason, e.g. `"Install Wix Stores app for <brand>"`
- `sourceDocUrl` — the Wix docs URL the recipe is from, e.g. `"https://dev.wix.com/docs/picasso/wix-ai-docs/recipes-v2/manage/platform/recipe-install-wix-apps"`

**2. `body` passed as a stringified JSON.** `body` is typed `anyOf: [object, array]` — pass it as a real structured value. `body: "{\"tenant\":…}"` will be rejected with `Expected object, received string`.

**The safe pattern — follow on the first `CallWixSiteAPI` of each session:**

1. **Load the schema** via your runtime's tool-discovery primitive (the orchestrator's Step 0 already did this for the whole session per `<SKILL_ROOT>/references/commands/mcp-bootstrap.md` — only re-load if you hit a tool-not-found error).
2. Call with the full shape:
   ```
   <prefix>CallWixSiteAPI(
     siteId: "<siteId from wix.config.json>",
     reason: "<one-sentence reason>",
     sourceDocUrl: "<URL of the Wix docs recipe you're following>",
     method: "POST",
     url: "https://www.wixapis.com/<service>/<path>",
     body: { …as a real object, not a string }
   )
   ```

**When you see reference snippets written in prose-HTTP form** (e.g. `CallWixSiteAPI: POST /blog/v3/posts` followed by `body: { … }`), translate them into the full tool-call shape above — the prose form omits the wrapper fields for readability, not because they're optional.

## Defensive fallback — required in every implementer agent

If a Wix MCP call returns "tool not found" or the tool name appears unavailable for any reason:

1. Re-discover the tool via your runtime's tool-discovery primitive, looking up the suffix (e.g. `CallWixSiteAPI`).
2. Use the discovered tool name and retry the call.
3. **Do NOT bail.** Only escalate to the user if discovery itself returns no match.

This guards against parents that forgot to pass the prefix and against future prefix-scheme changes.

---

## Prefer bundled reference docs over external doc reads

Your agent directory includes `.md` reference files with API recipes, call templates, and error handling tailored to your scope. These are your primary source — they document the exact call patterns, body shapes, and edge cases for your use case.

The Wix MCP also exposes documentation tools (`SearchWixRESTDocumentation`, `ReadFullDocsArticle`, `SearchWixSDKDocumentation`, etc.). These are useful when you hit an error or edge case not covered by your reference files. But **prefer your bundled `.md` files first** — each external doc read costs a tool call and 15-30s, and the bundled recipes are already validated for this plugin's flows.

**Rule of thumb:** read your reference files → try the documented recipe → only if you get an unexpected error or need an endpoint not covered, fall back to the MCP doc tools.

---

## Absolute paths — never trust CWD-relative instruction locations

Subagents launched by the orchestrator run with the project directory as CWD (e.g. `/Users/.../headless-projects/chairloom/`), not the skill root. Your instruction file and its sibling references live **inside the skill**, not in your CWD — e.g. the stores instructions live at `<skill-root>/references/stores/INSTRUCTIONS.md`.

**Rule:** every implementer prompt MUST include an `Instruction file (absolute path)` line pointing at the right `INSTRUCTIONS.md`. Read that file and only that path. Then use the absolute paths it lists for sibling references. Never:

- Resolve `references/stores/INSTRUCTIONS.md` against your CWD — it doesn't exist there.
- `Glob **/INSTRUCTIONS.md` or `**/agents/**` to "find" your instructions — that walks the project tree and finds nothing relevant; it's the most expensive failure mode in current runs.
- Walk up from the project directory looking for the skill root — guess wrong and you'll burn minutes globbing.

If your prompt is missing the absolute `Instruction file` line, ask the parent (don't guess). The `wix-headless` skill is responsible for computing and passing this absolute path in every agent-launch prompt (see `references/ORCHESTRATION.md` § "Agent prompt template").
