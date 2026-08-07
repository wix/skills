// Post-install deploy — run by base44.md STEP 1 with the target VERTICAL:
//   node deploy.cjs <vertical>   (storefront | bookings | blog | cms | portfolio | pricing-plans | events | members)
// Deploys the SHARED transport plus ONLY that vertical's REST helpers + UI client into /app/src,
// then pins project facts into AGENTS.md. Deploying just one vertical is deliberate: every vertical's
// app/ has files at the SAME paths (theme.css, components/…), so copying all of them into one src/
// would clobber (theme.css) and pile up (8 verticals' components/pages). paths are the Base44 sandbox's
// /app. Safe to re-run (idempotent). No vertical arg → deploys just the shared transport; re-run with
// the vertical once known.
// NOTE: .cjs on purpose — the app is an ESM package ("type":"module"); a .js here would load as ESM
// and require()/module.exports would throw.
const { readdirSync, existsSync, mkdirSync, copyFileSync, cpSync, readFileSync, appendFileSync } = require('fs');

const REF = '/app/.agents/skills/wix-vibe-headless/references';
const VERTICALS = ['storefront', 'bookings', 'blog', 'cms', 'portfolio', 'pricing-plans', 'events', 'members'];
const vertical = process.argv[2];
const deployed = { restScaffolds: [], vertical: null };

mkdirSync('/app/src/rest', { recursive: true });

// Copy a dir's top-level *.js into src/rest/ (REST helpers; subdirs like app/ and seed/ are skipped).
function copyRestJs(dir) {
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.js')) { copyFileSync(`${dir}/${f}`, `/app/src/rest/${f}`); deployed.restScaffolds.push(f); }
  }
}

// Shared transport — always (wix-client.js, wix-config.js, wix-manage-banner.js).
if (existsSync(`${REF}/shared`)) copyRestJs(`${REF}/shared`);

// The chosen vertical ONLY — its REST helpers -> src/rest/, its UI client (app/) -> src/.
if (vertical && VERTICALS.includes(vertical) && existsSync(`${REF}/${vertical}`)) {
  copyRestJs(`${REF}/${vertical}`);
  if (existsSync(`${REF}/${vertical}/app`)) cpSync(`${REF}/${vertical}/app`, '/app/src', { recursive: true });
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
