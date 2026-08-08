// Post-install deploy — run by base44.md STEP 1 with the target VERTICAL:
//   node deploy.cjs <vertical>   (storefront | bookings | blog | cms | portfolio | pricing-plans | events | members)
// ONE mechanism: recursively copy `app/` -> /app/src. The shared transport (app/rest/wix-client.js,
// wix-config.js) is copied always; then ONLY the chosen vertical's app/ (its UI + app/rest/ helpers).
// Deploying a single vertical is deliberate: every vertical's app/ has files at the SAME paths
// (components/…, pages/…), so copying all of them into one src/ would clobber and pile up. Two
// copies (not one) only because shared stays DRY. paths are the Base44 sandbox's /app. Re-running is
// non-destructive: it fills in only missing files, never overwriting the agent's edits (see COPY).
// No vertical arg -> deploys just the shared transport; re-run with the vertical once known.
// NOTE: .cjs on purpose — the app is an ESM package ("type":"module"); a .js here would load as ESM
// and require()/module.exports would throw.
const { existsSync, cpSync, readFileSync, appendFileSync } = require('fs');

const REF = '/app/.agents/skills/wix-vibe-headless/references';
const VERTICALS = ['storefront', 'bookings', 'blog', 'cms', 'portfolio', 'pricing-plans', 'events', 'members'];
const vertical = process.argv[2];
const deployed = { vertical: null };

// force:false + errorOnExist:false — fill in only files that AREN'T there yet; never overwrite.
// A re-run (e.g. the "files missing? re-run" fallback) then restores what's missing without
// clobbering the agent's edits (wired App.jsx, home/header components) from the first deploy.
const COPY = { recursive: true, force: false, errorOnExist: false };

// Shared transport — always (app/rest/wix-client.js, wix-config.js -> src/rest/).
if (existsSync(`${REF}/shared/app`)) cpSync(`${REF}/shared/app`, '/app/src', COPY);

// The chosen vertical ONLY — its app/ (UI + app/rest/ helpers) -> src/.
if (vertical && VERTICALS.includes(vertical) && existsSync(`${REF}/${vertical}/app`)) {
  cpSync(`${REF}/${vertical}/app`, '/app/src', COPY);
  deployed.vertical = vertical;
} else if (vertical) {
  deployed.error = `unknown vertical "${vertical}" — expected one of: ${VERTICALS.join(', ')}`;
} else {
  deployed.note = 'no vertical given — deployed the shared transport only; re-run: node deploy.cjs <vertical>';
}

// Pin the skill location + project facts into AGENTS.md so later turns (after this doc leaves
// context) still know the rules. Idempotent.
const NOTE = `

## This app — a Wix-managed headless frontend (built with the Wix skills)

This project is the **frontend for a Wix-managed business** — a REST client that talks directly to a live Wix site over \`WIX_CLIENT_ID\`. The **Wix site is the source of truth** for all content and commerce; build and seed it only through the Wix connector and the skills below. **Do NOT use the Base44 commerce kit (or any Base44 solution kit).**

The Wix skills live under \`.agents/skills/\` — on ANY turn, read them from that exact path (ignore stray copies like \`agent/skills/\`).

- \`wix-vibe-headless\` — **how the CLIENT is built AND how the site is seeded**: your vertical's UI client + REST scaffolds are already deployed into \`src/\`; one vertical per capability under \`references/<vertical>/\` (storefront, bookings, events, blog, portfolio, restaurants, cms, pricing-plans, members), each with a \`seed/\` module that creates content over the connector.
- \`wix-docs\` — **fallback** for **frontend code**, **backend code**, or **runtime / API management operations** alike: search + read the Wix API reference docs.
`;
const amd = '/app/AGENTS.md';
const cur = existsSync(amd) ? readFileSync(amd, 'utf8') : '';
if (!cur.includes('Wix-managed headless frontend')) { appendFileSync(amd, NOTE); deployed.agentsMdPinned = true; }

console.log(JSON.stringify(deployed));
