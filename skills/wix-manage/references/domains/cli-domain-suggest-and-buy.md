---
name: "CLI Domain Suggest and Buy"
description: Suggest available domains and start a domain purchase from the terminal using the Wix CLI `wix account domain` commands. Covers the account-level `wix account` command group, the `--msid` scoping flag, JSON output for agents, and the browser checkout handoff for `domain buy`.
---
# CLI Domain Suggest and Buy

Use this recipe when a user (or an agent working in a terminal) wants to:

- Find available domains for a keyword, brand, or business idea using the Wix CLI
- Start buying a domain from the command line
- Says something like "suggest domains for my coffee shop from the CLI", "wix account domain buy example.com"

This is the **CLI** path. For the REST API / MCP flow (availability checks, pre-configured carts, contact collection), use [Domain Search and Purchase](domain-search-and-purchase.md) instead.

## The `wix account` Command Group

`wix account` holds **account-level admin commands**. Two things apply to every command in the group:

- **Login is required.** All `account` commands use the account OAuth session. Log in first with `npx @wix/cli@latest login`.
- **`--msid <msid>`** — a group-level option that scopes account commands to a specific site (meta-site ID). It **must be placed right after `account`**, before the subcommand:

  ```bash
  npx @wix/cli@latest account --msid <metaSiteId> domain buy example.com
  ```

  If `--msid` is omitted, the CLI falls back to the `siteId` in the local `wix.config.json` / `wix.config.mjs`. If there is no config file either, commands run **account-wide** (no site scope).

---

## `wix account domain suggest <query>`

Suggest available domains for a keyword, brand, or business idea.

**Arguments**:

| Argument | Description |
|----------|-------------|
| `<query>` | Keywords, brand, or business idea. 3–100 characters. |

**Options**:

| Option | Description |
|--------|-------------|
| `-l, --limit <number>` | Number of suggestions to return, 1–20. |
| `-t, --tld <tld...>` | Filter by up to 10 TLDs, without the dot (e.g. `com net io`). |
| `--json` | Output JSON instead of human-readable text. |

**Output**: one available domain per line. All returned domains are available for purchase — no need to re-check availability. With `--json`:

```json
{
  "suggestions": [
    { "domain": "coffeeshop.com" },
    { "domain": "coffeeshop.net" }
  ]
}
```

**Examples**:

```bash
npx @wix/cli@latest account domain suggest "coffee shop"
npx @wix/cli@latest account domain suggest coffee --limit 5 --tld com io
npx @wix/cli@latest account domain suggest coffee --json
```

> Agents: prefer `--json` for parsing suggestions programmatically.

---

## `wix account domain buy <domain>`

Start buying a domain. **Payment always completes in the browser** (Wix hosted checkout) — the command opens the browser to the checkout page; it does not charge anything itself.

**Arguments**:

| Argument | Description |
|----------|-------------|
| `<domain>` | Full domain including the TLD (e.g. `example.com`). |

**Options**:

| Option | Description |
|--------|-------------|
| `--no-open` | Print the purchase URL instead of opening the browser. |

**URL behavior**:

- **With an msid** (from `--msid` or resolved from `wix.config.json`/`wix.config.mjs`), it opens the site-scoped checkout:
  `https://manage.wix.com/dashboard/{msid}/premium-express-checkout-app/bundle-selection?domainName=<domain>`
- **Without an msid**, it opens the standalone purchase flow:
  `https://manage.wix.com/get-domain?domainName=<domain>&flowType=purchase`

**Examples**:

```bash
npx @wix/cli@latest account domain buy example.com
npx @wix/cli@latest account domain buy example.com --no-open
npx @wix/cli@latest account --msid <metaSiteId> domain buy example.com
```

> **Agents: expect a browser handoff, not a headless purchase.** In CI, non-interactive, or agent environments (or with `--no-open`), the command prints the purchase URL instead of opening a browser. Surface that URL to the user so they can complete payment — do not wait for the purchase to finish.

---

## Example Flows

### Flow 1: Suggest, then buy

1. User: "Find me a domain for my coffee shop and buy it"
2. `npx @wix/cli@latest account domain suggest "coffee shop" --json` → present the suggestions
3. User picks `coffeeshop.io`
4. `npx @wix/cli@latest account domain buy coffeeshop.io --no-open` → share the printed checkout URL with the user to complete payment

### Flow 2: Buy scoped to a site

1. User: "Buy example.com for my site" (meta-site ID known, e.g. from `wix.config.json` or the user)
2. `npx @wix/cli@latest account --msid <metaSiteId> domain buy example.com --no-open`
3. Share the site-scoped checkout URL — after payment the domain is set up on that site

### Flow 3: Not logged in

1. Any `account` command fails with an authentication error
2. Run `npx @wix/cli@latest login`, complete the browser login, then retry the command
