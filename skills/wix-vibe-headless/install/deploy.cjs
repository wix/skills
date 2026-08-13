// Post-install deploy — run by base44.md STEP 1 with the vertical(s) the app needs:
//   node deploy.cjs <vertical> [<vertical> …] --client-id <id> --metasite-id <id>
//   (storefront | bookings | blog | cms | portfolio | pricing-plans | events | members)
// Pass the two ids from the prompt and this writes src/rest/wix-config.js for you — see WRITE below.
// Retyping those ids into the file by hand is how a storefront ships with a dead client id.
// ONE mechanism: recursively copy `app/` -> /app/src. The shared transport (app/rest/wix-client.js,
// wix-config.js) is copied always; then each named vertical's app/ (its UI + app/rest/ helpers).
// Deploy every vertical the app actually uses, in one call or across several — an app that needs both
// members and cms names both, and its CMS helpers then come from the skill instead of being
// hand-written. Order matters only where two verticals ship a file at the SAME path (both have
// components/…, pages/…): the first one listed wins, since the copy never overwrites. Verticals whose
// file sets don't overlap (cms ships utils only, no UI) combine freely.
// paths are the Base44 sandbox's /app. Re-running is non-destructive: it fills in only missing files,
// never overwriting the agent's edits (see COPY), so a later call can add a vertical safely.
// No vertical arg -> deploys just the shared transport; re-run with the vertical(s) once known.
// NOTE: .cjs on purpose — the app is an ESM package ("type":"module"); a .js here would load as ESM
// and require()/module.exports would throw.
const { existsSync, cpSync, readFileSync, writeFileSync } = require('fs');

const REF = '/app/.agents/skills/wix-vibe-headless/references';
const WIX_CONFIG = '/app/src/rest/wix-config.js';
const VERTICALS = ['storefront', 'bookings', 'blog', 'cms', 'portfolio', 'pricing-plans', 'events', 'members', 'restaurants'];

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

// --- WRITE the credentials ----------------------------------------------------------------------
//
// The two ids arrive as flags so this script writes them once, character-for-character, instead of a
// later hand-edit of the placeholder file.
//
// An id already in the file wins; the flags only fill what is unset. A host that writes this file
// at app creation (Base44) has each id as an exact value rather than a copy read out of a prompt.
// Per id, so a host that resolved one but not the other still gets the gap filled.
//
// This briefly worked the other way round for WIX_METASITE_ID, while Base44 could write a different
// site than the business: it shared one field between the launch and a metasite it provisions per
// app, and the launch's id lost. Fixed on that side, and the ids it stores now verify against the
// site each launch came from, so the file is trusted again.
function readWixConfig() {
  if (!existsSync(WIX_CONFIG)) return {};
  const src = readFileSync(WIX_CONFIG, 'utf8');
  const pick = (name) => {
    const v = (src.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`)) || [])[1] || '';
    return v.startsWith('<') ? '' : v;   // the shipped file's `<YOUR-…>` placeholders count as unset
  };
  return { clientId: pick('WIX_CLIENT_ID'), metaSiteId: pick('WIX_METASITE_ID') };
}

function writeWixConfig(clientId, metaSiteId) {
  const body = [
    '// Wix credentials — written by the skill\'s deploy step from the ids in your prompt.',
    '// Safe to commit: WIX_CLIENT_ID is a public, buyer-facing id (it only mints anonymous visitor',
    '// tokens); WIX_METASITE_ID just identifies the site.',
    `export const WIX_CLIENT_ID = "${clientId}";`,
    `export const WIX_METASITE_ID = "${metaSiteId}";`,
    '',
  ].join('\n');
  writeFileSync(WIX_CONFIG, body);
}

// --- main ---------------------------------------------------------------------------------------

// Accept one or many: `deploy.cjs members cms`. Duplicates collapse; order is preserved so the
// first vertical listed wins any same-path file (the copy never overwrites).
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const clientId = flag('client-id');
const metaSiteId = flag('metasite-id');
// Verticals are the positional args — drop the flags and their values.
const flagArgs = new Set(['--client-id', '--metasite-id', clientId, metaSiteId].filter(Boolean));
const requested = [...new Set(argv.filter((a) => !flagArgs.has(a)))];
const deployed = { verticals: [] };

// Shared transport — always (app/rest/wix-client.js, wix-config.js -> src/rest/).
if (existsSync(`${REF}/shared/app`)) cpSync(`${REF}/shared/app`, '/app/src', COPY);

// Each named vertical — its app/ (UI + app/rest/ helpers) -> src/.
const unknown = requested.filter((v) => !VERTICALS.includes(v));
for (const vertical of requested.filter((v) => VERTICALS.includes(v))) {
  if (!existsSync(`${REF}/${vertical}/app`)) continue;
  cpSync(`${REF}/${vertical}/app`, '/app/src', COPY);
  deployed.verticals.push(vertical);
  if (vertical === 'members') deployed.authPagesFixed = replaceMembersAuthLeftovers();
}

if (unknown.length) {
  deployed.error = `unknown vertical(s) ${unknown.map((v) => `"${v}"`).join(', ')} — expected: ${VERTICALS.join(', ')}`;
}
if (!requested.length) {
  deployed.note = 'no vertical given — deployed the shared transport only; re-run: node deploy.cjs <vertical> [<vertical> …]';
}

const onDisk = readWixConfig();
const finalClientId = onDisk.clientId || clientId;
const finalMetaSiteId = onDisk.metaSiteId || metaSiteId;

if (!finalClientId || !finalMetaSiteId) {
  deployed.wixConfig = 'missing_ids — src/rest/wix-config.js is not configured; re-run with '
    + '--client-id and --metasite-id rather than editing the file by hand';
} else if (finalClientId === onDisk.clientId && finalMetaSiteId === onDisk.metaSiteId) {
  deployed.wixConfig = 'already_set';
} else {
  writeWixConfig(finalClientId, finalMetaSiteId);
  deployed.wixConfig = 'written';
}

console.log(JSON.stringify(deployed));
