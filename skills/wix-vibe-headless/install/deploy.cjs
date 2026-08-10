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
const { existsSync, cpSync, readFileSync } = require('fs');

const REF = '/app/.agents/skills/wix-vibe-headless/references';
const VERTICALS = ['storefront', 'bookings', 'blog', 'cms', 'portfolio', 'pricing-plans', 'events', 'members'];

// force:false + errorOnExist:false — fill in only files that AREN'T there yet; never overwrite.
// A re-run (e.g. the "files missing? re-run" fallback) then restores what's missing without
// clobbering the agent's edits (wired App.jsx, home/header components) from the first deploy.
const COPY = { recursive: true, force: false, errorOnExist: false };

// --- members vertical only: replace leftover Base44 auth pages -------------------------------
//
// Base44 seeds src/pages/Login.jsx + src/pages/Register.jsx into every custom-auth-enrolled app
// at APP CREATION, before any Wix skill ever runs (backend/app/user_apps/auth_templates/_loader.py
// in the platform repo). The members vertical's own Login.jsx lands at that SAME path via the COPY
// above, but COPY's force:false skips it because Base44's file is already there — so the Base44-auth
// page silently survives instead of the Wix-auth one, and the app ends up with two half-wired auth
// systems. There is no Wix Register.jsx at all (LoginForm's own "Sign up" tab covers registration),
// so Base44's Register.jsx was never even in contention — it just sits there, wrong, either way.
//
// Fix both, but ONLY when the file currently on disk is still recognizably Base44's boilerplate
// (imports base44Client / calls base44.auth.*). Never touch a file that's already the Wix version
// or an agent's own customization — same "don't clobber" contract as COPY above, just evaluated on
// content instead of mere existence.
function isBase44AuthBoilerplate(path) {
  if (!existsSync(path)) return false;
  const src = readFileSync(path, 'utf8');
  return src.includes('@/api/base44Client') || src.includes('base44.auth.');
}

// Each entry: the src/ file to repair, and the reference file that replaces it.
// Login.jsx comes from the vertical's shipped pages; Register.jsx from references/members/install/
// (a repair stub kept OUT of app/ — this vertical ships no /register route, so a fresh app with no
// Base44 leftover must not receive it).
const MEMBERS_AUTH_REPAIRS = [
  { dest: '/app/src/pages/Login.jsx', src: `${REF}/members/app/pages/Login.jsx` },
  { dest: '/app/src/pages/Register.jsx', src: `${REF}/members/install/Register.jsx` },
];

function replaceMembersAuthLeftovers() {
  const result = {};
  for (const { dest, src } of MEMBERS_AUTH_REPAIRS) {
    const name = dest.split('/').pop().replace('.jsx', '').toLowerCase();
    if (existsSync(src) && isBase44AuthBoilerplate(dest)) {
      cpSync(src, dest, { force: true });
      result[name] = 'replaced_base44_leftover';
    } else {
      result[name] = 'left_as_is';
    }
  }
  return result;
}

// --- main ---------------------------------------------------------------------------------------

const vertical = process.argv[2];
const deployed = { vertical: null };

// Shared transport — always (app/rest/wix-client.js, wix-config.js -> src/rest/).
if (existsSync(`${REF}/shared/app`)) cpSync(`${REF}/shared/app`, '/app/src', COPY);

// The chosen vertical ONLY — its app/ (UI + app/rest/ helpers) -> src/.
if (vertical && VERTICALS.includes(vertical) && existsSync(`${REF}/${vertical}/app`)) {
  cpSync(`${REF}/${vertical}/app`, '/app/src', COPY);
  deployed.vertical = vertical;
  if (vertical === 'members') deployed.authPagesFixed = replaceMembersAuthLeftovers();
} else if (vertical) {
  deployed.error = `unknown vertical "${vertical}" — expected one of: ${VERTICALS.join(', ')}`;
} else {
  deployed.note = 'no vertical given — deployed the shared transport only; re-run: node deploy.cjs <vertical>';
}

console.log(JSON.stringify(deployed));
