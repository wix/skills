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
const { existsSync, cpSync } = require('fs');

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

console.log(JSON.stringify(deployed));
