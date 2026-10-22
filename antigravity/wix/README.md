# Wix

Build Wix apps and headless websites, and manage your Wix business, from Antigravity. The plugin connects the agent to your Wix account through the official Wix MCP server and adds skills for the Wix CLI, Wix Headless, and the Wix business APIs.

> These skills target the new [Wix CLI](https://dev.wix.com/docs/wix-cli/guides/about-the-wix-cli). They don't generate legacy Velo or Corvid code.

## What you can do

- **Build Wix app extensions:** dashboard pages and modals, site widgets and plugins, backend APIs and events, service plugins (shipping, tax, discounts), embedded scripts, and data collections.
- **Build headless sites:** a store, bookings, blog, events, restaurant, portfolio, members area, and more, on shipped, verified Wix code, released to Wix hosting or wired into a front end you already have.
- **Manage your Wix business:** set up products, services, CMS collections, pricing plans and more on your sites, through the Wix REST APIs.
- **Look things up:** Wix API and SDK docs, and Wix Design System components and props.

## What's included

- **Wix MCP server** (`https://mcp.wix.com/mcp`): lists your sites, calls Wix APIs on them, and searches the Wix docs. The first time a Wix tool is used, you sign in to your Wix account in the browser; the server shows in **/mcp** as `wix_mcp`.
- **Skills**
  - `wix-app`: build and review Wix CLI app extensions, and prepare an app for the Wix App Market.
  - `wix-design-system`: Wix Design System component reference.
  - `wix-manage`: REST recipes for configuring Wix business solutions: stores, bookings, payments, CMS, and more.
  - `wix-headless-kit`: build and release a headless site fast on shipped, per-solution code.
  - `wix-headless-templates`: the shipped per-solution code `wix-headless-kit` builds from.
  - `wix-vibe-headless`: connect an existing front end to a live Wix site over client-only REST.
  - `wix-docs`: look up an exact Wix endpoint, field or schema before writing code.

## Requirements

- A [Wix account](https://www.wix.com).
- [Node.js](https://nodejs.org), for the Wix CLI and the skills' helper scripts.

## Learn more

- [About Wix Skills](https://dev.wix.com/docs/api-reference/articles/ai-tools/about-wix-skills)
- [Wix MCP](https://dev.wix.com/docs/sdk/articles/use-the-wix-mcp/about-the-wix-mcp)
- [Source and issues](https://github.com/wix/skills)
