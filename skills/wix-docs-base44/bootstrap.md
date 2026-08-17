# Wix docs lookup — Base44 bootstrap

Paste this (plus your question) to a Base44 builder agent. It installs the skill into the app once,
then the agent works from the installed files — the module arrives as a git-cloned file, never
retyped by the model.

---

STEP 0 — install the `wix-docs-base44` skill. Run this through exec_tool, exactly as written:

```js
const { execSync } = require('child_process');
const { existsSync } = require('fs');
const SRC = 'wix/skills/skills/wix-docs-base44';   // pre-merge testing: append '#<branch>'
if (existsSync('/app/.agents/skills/wix-docs-base44/SKILL.md')) return { skill: 'already_installed' };
const out = execSync(`CI=1 npx -y skills add ${SRC} --yes 2>&1`,
  { cwd: '/app', timeout: 60000, shell: '/bin/bash' }).toString().replace(/\x1b\[[0-9;]*m/g, '');
return { skill: /Installed 1 skill/i.test(out) ? 'success' : out.slice(-300) };
```

STEP 1 — read `.agents/skills/wix-docs-base44/SKILL.md` with read_file (workspace-relative path —
absolute `/app/...` fails) and follow it EXACTLY. Load its module from
`/app/.agents/skills/wix-docs-base44/scripts/docs.js`.

Then answer the question you were asked, per the skill's rules: cite file and line, name the
product, and reach one of its three outcomes — the docs show it, the docs show something adjacent,
or you enumerated the resource's methods and none of them do it.
