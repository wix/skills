// Post-install deploy — run once by base44.md STEP 1, AFTER `npx skills add` has put the skills on
// disk under /app/.agents/skills/. Deploys the client into the app and pins project facts. No args;
// paths are the Base44 sandbox's /app. Safe to re-run (idempotent): copies overwrite, AGENTS.md note
// is appended only once.
const { readdirSync, existsSync, mkdirSync, copyFileSync, cpSync, readFileSync, appendFileSync } = require('fs');

const REF = '/app/.agents/skills/wix-vibe-headless/references';
const deployed = { restScaffolds: [], uiVerticals: [] };

if (existsSync(REF)) {
  mkdirSync('/app/src/rest', { recursive: true });
  for (const dir of readdirSync(REF)) {
    let files;
    try { files = readdirSync(`${REF}/${dir}`); } catch { continue; }   // skip non-dirs
    // Flat: every vertical's REST scaffold -> src/rest/ (siblings import ./wix-client.js).
    for (const f of files) {
      if (f.endsWith('.js')) { copyFileSync(`${REF}/${dir}/${f}`, `/app/src/rest/${f}`); deployed.restScaffolds.push(f); }
    }
    // A vertical may ship a ready UI client under app/ (e.g. storefront) -> deploy it into src/ as-is.
    if (existsSync(`${REF}/${dir}/app`)) { cpSync(`${REF}/${dir}/app`, '/app/src', { recursive: true }); deployed.uiVerticals.push(dir); }
  }
}

// Pin the skill location + project facts into AGENTS.md so later turns (after this doc leaves
// context) still know the rules. Idempotent.
const NOTE = `

## This app — a Wix-managed headless frontend (built with the Wix skills)

This project is the **frontend for a Wix-managed business** — a REST client that talks directly to a live Wix site over \`WIX_CLIENT_ID\`. The **Wix site is the source of truth** for all content and commerce; build and seed it only through the Wix connector and the skills below. **Do NOT use the Base44 commerce kit (or any Base44 solution kit).**

The Wix skills live under \`.agents/skills/\` — on ANY turn, read them from that exact path (ignore stray copies like \`agent/skills/\`).

- \`wix-vibe-headless\` — **how the CLIENT is built AND how the site is seeded**: REST scaffolds + (some verticals) a ready UI client, already deployed into \`src/\`; one vertical per capability under \`references/<vertical>/\` (storefront, bookings, events, blog, portfolio, restaurants, cms, pricing-plans, members), each with a \`seed/\` module that creates content over the connector.
- \`wix-docs\` — **fallback** for **frontend code**, **backend code**, or **runtime / API management operations** alike: search + read the Wix API reference docs.
`;
const amd = '/app/AGENTS.md';
const cur = existsSync(amd) ? readFileSync(amd, 'utf8') : '';
if (!cur.includes('Wix-managed headless frontend')) { appendFileSync(amd, NOTE); deployed.agentsMdPinned = true; }

console.log(JSON.stringify(deployed));
