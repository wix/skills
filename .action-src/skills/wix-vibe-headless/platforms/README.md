# Vibe platform handoff prompts

One file per AI-builder platform (Base44, Lovable, Bolt, v0, Manus, …). Each file is the
**handoff prompt** the Wix Headless funnel hands to that platform after it creates the site +
OAuth app: build the client, then seed/manage the business.

`generic.md` is the **platform-agnostic** version — same flow (install skills → build client →
seed/manage → wrap up) with no assumptions about a specific platform's tooling. Use it as the
default/fallback for platforms without their own tuned file; `base44.md` is the Base44-specific
one (its exec tool, secret store, pre-configured connector, etc.).

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
