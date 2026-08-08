# Vibe platform handoff prompts

One file per AI-builder platform (Base44, Lovable, Bolt, v0, Manus, …). Each file is the
**handoff prompt** the Wix Headless funnel hands to that platform after it creates the site +
OAuth app: build the client, then seed/manage the business.

`generic.md` is the **platform-agnostic** version and the default/fallback for any platform without
its own tuned file. It is also a **lens over the skill**: the skill's `SKILL.md` + per-vertical
`INSTRUCTIONS.md` are written for Base44's stack (Vite + react-router + `.jsx`, files pre-copied into
`src/`), so `generic.md` tells a non-Base44 agent what the skill's three real assets are (the `rest/`
client layer, the field-shape/route-pattern data contract, the `seed/` functions), which Base44-isms
to ignore/translate, and the hard rule to **generate into the existing stack — never convert the
framework**. `base44.md` is the Base44-specific one (its exec tool, secret store, pre-configured
connector, `deploy.cjs` copy path, etc.).

These are hosted (served at `https://www.wix.com/skills/vibe-headless/platforms/<platform>.md`)
so the funnel loader can pass a short pointer to the prompt instead of inlining the whole
script into the launch URL. Inlining tripped the Base44 edge WAF, which scans the POST body
for command-injection patterns (`curl … | tar`, `require('child_process')`, etc.); a plain
GET of a hosted file is not scanned that way.

**Loader contract:** the funnel sends a short prompt that names the business, passes the Wix
client id + metasite id, and points here — e.g. "Build a site for my Wix managed business:
&lt;business&gt;. Then fetch and follow https://www.wix.com/skills/vibe-headless/platforms/base44.md
exactly." The dynamic bits (business description, client id, metasite id) stay in the loader
prompt; everything static lives in these files.
