# Playwright MCP Reference

MCP server: `playwright` (via `@playwright/mcp`)

## MCP Configuration

This skill requires Playwright MCP to be configured. Create a `.mcp.json` file in your project root with the following configuration:

```json
{
    "mcpServers": {
        "playwright": {
            "command": "npx",
            "args": [
                "@playwright/mcp@latest"
            ]
        }
    }
}
```

The MCP server will be automatically used when executing e2e validation steps.

## Core Tools

### Navigation

**playwright__browser-navigate**

Navigate to a URL.

```json
{ "url": "https://example.wix-preview.com/..." }
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | URL to navigate to |

### Page Inspection

**playwright__browser-snapshot**

Capture accessibility snapshot of the current page. Preferred over screenshots for understanding page structure.

```json
{}
```

No parameters required. Returns the accessibility tree of the page.

**playwright__browser-take-screenshot**

Take a screenshot of the current page.

```json
{ "fullPage": true, "filename": "validation-screenshot.png" }
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fullPage` | boolean | No | Capture full scrollable page |
| `filename` | string | No | Output filename |
| `type` | "png" \| "jpeg" | No | Image format (default: png) |
| `ref` | string | No | Element reference for element screenshot |
| `element` | string | No | Element description (required with ref) |

### Console & Errors

**playwright__browser-console-messages**

Returns all console messages. Essential for detecting runtime errors.

```json
{}
```

No parameters required. Returns all console output including:
- `console.log` messages
- `console.warn` messages
- `console.error` messages
- Uncaught exceptions

### JavaScript Evaluation

**playwright__browser-evaluate**

Execute JavaScript in the page context.

```json
{
  "function": "() => document.querySelectorAll('.error').length"
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `function` | string | Yes | JavaScript function to execute |
| `ref` | string | No | Element reference for scoped execution |
| `element` | string | No | Element description (required with ref) |

## Validation Patterns

### Detect Runtime Errors

```json
Tool: playwright__browser-console-messages
Args: {}
```

Check the returned messages for:
- Type `error`: JavaScript errors
- Messages containing "Uncaught", "Exception", "Error"
- Failed fetch/XHR requests

### Verify Element Exists

```json
Tool: playwright__browser-evaluate
Args: { "function": "() => !!document.querySelector('[data-testid=\"my-component\"]')" }
```

### Check for React Errors

```json
Tool: playwright__browser-evaluate
Args: { "function": "() => document.querySelectorAll('[data-reactroot]').length > 0" }
```

### Get Page Title

```json
Tool: playwright__browser-evaluate
Args: { "function": "() => document.title" }
```

### Check for Loading States

```json
Tool: playwright__browser-evaluate
Args: { "function": "() => !document.querySelector('.loading, .spinner, [data-loading=\"true\"]')" }
```

## Additional Tools

These tools are available for interactive testing if needed:

| Tool | Description |
|------|-------------|
| `playwright__browser-click` | Click on an element |
| `playwright__browser-type` | Type text into an input |
| `playwright__browser-hover` | Hover over an element |
| `playwright__browser-wait-for` | Wait for an element or condition |
| `playwright__browser-network-requests` | View network activity |
| `playwright__browser-navigate-back` | Navigate back in history |
| `playwright__browser-close` | Close the browser |
