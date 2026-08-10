// Pin the skill location + project facts into /app/AGENTS.md so later turns (after the platform
// build doc leaves context) still know the rules. Idempotent — safe to re-run; writes at most once.
// Run once by base44.md STEP 1, separately from per-vertical deploys (deploy.cjs), so "copy a
// vertical's files" and "record the project's ground rules" stay independent concerns.
// .cjs on purpose — the app is an ESM package ("type":"module"); a .js here would load as ESM and
// require()/module.exports would throw.
const { existsSync, readFileSync, appendFileSync } = require('fs');

const NOTE = `

## This app — a Wix-managed headless frontend (built with the Wix skills)

This project is the **frontend for a Wix-managed business** — a REST client that talks directly to a live Wix site over \`WIX_CLIENT_ID\`. The **Wix site is the source of truth** for all content and commerce; build and seed it only through the Wix connector and the skills below. **Do NOT use the Base44 commerce kit (or any Base44 solution kit).**

The Wix skills live under \`.agents/skills/\` — on ANY turn, read them from that exact path (ignore stray copies like \`agent/skills/\`).

- \`wix-vibe-headless\` — **how the CLIENT is built AND how the site is seeded**: your vertical's UI client + REST scaffolds are already deployed into \`src/\`; one vertical per capability under \`references/<vertical>/\` (storefront, bookings, events, blog, portfolio, restaurants, cms, pricing-plans, members), each with a \`seed/\` module that creates content over the connector.
- \`wix-docs\` — **fallback** for **frontend code**, **backend code**, or **runtime / API management operations** alike: search + read the Wix API reference docs.
`;

const amd = '/app/AGENTS.md';
const cur = existsSync(amd) ? readFileSync(amd, 'utf8') : '';
const pinned = !cur.includes('Wix-managed headless frontend');
if (pinned) appendFileSync(amd, NOTE);
console.log(JSON.stringify({ agentsMdPinned: pinned }));
