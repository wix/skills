# Wix Doc Tools — Prefix Discovery (Optional)

This skill performs all site operations via the Wix REST API + `wix token --site <id>` (no MCP server required). The Wix MCP server is **optional**, and only used for documentation lookups when an unfamiliar API or schema comes up.

If the Wix MCP server is connected, these doc-lookup tools become available:

`WixREADME`, `SearchWixHeadlessDocumentation`, `SearchWixSDKDocumentation`, `SearchWixRESTDocumentation`, `BrowseWixRESTDocsMenu`, `ReadFullDocsArticle`, `ReadFullDocsMethodSchema`.

They are exposed under one of two prefixes depending on the install mode:

| Install mode | Prefix |
|---|---|
| **Plugin** (typical for end users) | `mcp__plugin_<plugin-name>_wix-mcp-remote__` (e.g. `mcp__plugin_wix-headless_wix-mcp-remote__WixREADME`) |
| **Direct MCP server** | `mcp__wix-mcp-remote__` (e.g. `mcp__wix-mcp-remote__WixREADME`) |

Reference files use the canonical short form (`mcp__wix-mcp-remote__<suffix>`) for readability — substitute the actual prefix at runtime if you're invoking these tools.

---

## Prefix discovery (only if you intend to call a doc tool)

1. Use whatever tool-discovery primitive your runtime provides to look up `WixREADME`.
2. From the returned tool name, strip the trailing `WixREADME` — what remains (ending in `wix-mcp-remote__`) is the prefix. Examples:
   - Returned name `mcp__plugin_wix_wix-mcp-remote__WixREADME` → prefix `mcp__plugin_wix_wix-mcp-remote__`
   - Returned name `mcp__wix-mcp-remote__WixREADME` → prefix `mcp__wix-mcp-remote__`
3. **If discovery returns no match:** the Wix MCP server isn't connected. Don't fail — the skill's operations don't need MCP. Just skip the doc lookup and proceed with bundled reference files.

---

## Prefer bundled reference docs over external doc reads

Your agent directory includes `.md` reference files with API recipes, call templates, and error handling tailored to your scope. These are your primary source — they document the exact call patterns, body shapes, and edge cases for your use case.

The Wix MCP doc tools are useful when you hit an error or edge case not covered by your reference files. But **prefer your bundled `.md` files first** — each external doc read costs a tool call and 15–30 s, and the bundled recipes are already validated for this plugin's flows.

**Rule of thumb:** read your reference files → try the documented recipe → only if you get an unexpected error or need an endpoint not covered, fall back to the Wix MCP doc tools (if available).

---

## Absolute paths — never trust CWD-relative instruction locations

Subagents launched by the orchestrator run with the project directory as CWD (e.g. `/Users/.../headless-projects/chairloom/`), not the skill root. Your instruction file and its sibling references live **inside the skill**, not in your CWD — e.g. the stores instructions live at `<skill-root>/references/stores/INSTRUCTIONS.md`.

**Rule:** every implementer prompt MUST include an `Instruction file (absolute path)` line pointing at the right `INSTRUCTIONS.md`. Read that file and only that path. Then use the absolute paths it lists for sibling references. Never:

- Resolve `references/stores/INSTRUCTIONS.md` against your CWD — it doesn't exist there.
- `Glob **/INSTRUCTIONS.md` or `**/agents/**` to "find" your instructions — that walks the project tree and finds nothing relevant; it's the most expensive failure mode in current runs.
- Walk up from the project directory looking for the skill root — guess wrong and you'll burn minutes globbing.

If your prompt is missing the absolute `Instruction file` line, ask the parent (don't guess). The `wix-headless` skill is responsible for computing and passing this absolute path in every agent-launch prompt (see `references/ORCHESTRATION.md` § "Agent prompt template").
