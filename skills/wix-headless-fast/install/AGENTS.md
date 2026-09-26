## CLI Commands

All CLI instructions can be found at:
node_modules/@wix/cli/agents/instructions.md

## This app

A Wix Headless app built on the live Wix site named in `wix.config.json`. The site owns the
content and commerce.

**No Wix endpoint, body or field from memory.** Every Wix call comes from the skills below or the
code they deployed.

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
