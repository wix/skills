## CLI Commands

All CLI instructions can be found at:
node_modules/@wix/cli/agents/instructions.md

## This app

A Wix Headless app built on the live Wix site named in `wix.config.json`. The site owns the
content and commerce.{{MIGRATION}}

**Never work from training data or memory about the Wix APIs.** Not a URL, a path, a header, a
field name or a body. Every Wix call you write comes from the official Wix skills installed here,
the code they deployed first, or, when they do not cover the call, from the official Wix
documentation through `wix-docs`. Read it there first, then write the call: the exact path and
body copied from the output you read in this session. A call built by analogy from another
call is memory, and an empty or error reply to it says nothing about the site.

## Skills

Installed at `.agents/skills/`. If missing, restore with:
`CI=1 npx skills@latest add wix/skills --skill {{SKILL}} --skill wix-docs --skill wix-manage --yes`

- `{{SKILL}}` — the code in this app and how to extend it. The shipped code sits in
  `.agents/skills/{{SKILL}}/templates/`, fetched once from the skill's repository and kept with this
  project at the commit it was built from (`templates/.source`); if that folder is missing,
  `node .agents/skills/{{SKILL}}/install/templates.mjs` fetches it. Each business solution has a playbook at
  `templates/<solution>/INSTRUCTIONS.md`; `node .agents/skills/{{SKILL}}/install/deploy.mjs <solution> --stack {{STACK}}`
  adds one; `node .agents/skills/{{SKILL}}/templates/<solution>/seed/read-site.mjs` reads what the
  site holds for it, with the documentation URL of every call it made. A code change ends with a release; the live URL shows it, the dev server does not count.
  `node .agents/skills/{{SKILL}}/install/check.mjs` says whether the skill or its templates have a newer
  version and prints the update commands; an update touches the skill folder or `templates/`, never `src/`.
- `wix-docs` — how to discover the Wix APIs and their docs: search first, then read only the page
  you need. Every endpoint, body, field and enum you did not get from the deployed code or a recipe
  is confirmed there before you write it.
- `wix-manage` — recipes for the live site itself (content, prices, settings), run from the shell
  with `npx -y @wix/cli@latest token --site <siteId>`, minted inline in each command; the token
  never lands in a file anywhere (not the project, not `/tmp`) nor in client code.
