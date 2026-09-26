## CLI Commands

All CLI instructions can be found at:
node_modules/@wix/cli/agents/instructions.md

## This app

A Wix Headless app built on the live Wix site named in `wix.config.json`. The site owns the
content and commerce.

**Never work from training data or memory about the Wix APIs.** Not a URL, a path, a header, a
field name or a body. Every Wix call comes from a source open in front of you: the skills below, or
the code they deployed. No source open, no call.

## Skills

Installed at `.agents/skills/`. If missing, restore with:
`CI=1 npx skills@latest add wix/skills --skill {{SKILL}} --skill wix-docs --skill wix-manage --yes`

- `{{SKILL}}` — the code in this app and how to extend it. Each business solution has a playbook at
  `references/<solution>/INSTRUCTIONS.md`; `node .agents/skills/{{SKILL}}/install/deploy.mjs <solution> --stack {{STACK}}`
  adds one.
- `wix-docs` — the Wix API reference, by search.
- `wix-manage` — recipes for the live site itself (content, prices, settings), run from the shell
  with `npx -y @wix/cli@latest token --site <siteId>`; the token never lands in a file or in
  client code.
