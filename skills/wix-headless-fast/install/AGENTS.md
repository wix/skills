## CLI Commands

All CLI instructions can be found at:
node_modules/@wix/cli/agents/instructions.md

## This app

A Wix Headless app built on the live Wix site named in `wix.config.json`. The site owns the
content and commerce.

**Never work from training data or memory about the Wix APIs.** Not a URL, a path, a header, a
field name or a body. Every Wix call you write comes from the official Wix skills installed here,
the code they deployed first, or, when they do not cover the call, from the official Wix
documentation through `wix-docs`. Read it there first, then write the call.

## Skills

Installed at `.agents/skills/`. If missing, restore with:
`CI=1 npx skills@latest add wix/skills --skill {{SKILL}} --skill wix-docs --skill wix-manage --yes`

- `{{SKILL}}` — the code in this app and how to extend it. Each business solution has a playbook at
  `references/<solution>/INSTRUCTIONS.md`; `node .agents/skills/{{SKILL}}/install/deploy.mjs <solution> --stack {{STACK}}`
  adds one.
- `wix-docs` — how to discover the Wix APIs and their docs: search first, then read only the page
  you need. Every endpoint, body, field and enum you did not get from the deployed code or a recipe
  is confirmed there before you write it.
- `wix-manage` — recipes for the live site itself (content, prices, settings), run from the shell
  with `npx -y @wix/cli@latest token --site <siteId>`; the token never lands in a file or in
  client code.
