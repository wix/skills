#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readEnvFile, upsertEnvFile, statEnvKeys } = require('../lib/config-env.js');

function usage() {
  return [
    'Usage:',
    '  node scripts/wix-headless-scaffold.js --business-name <name> [--folder-name frontend] [--site-template commerce] [--project-dir <dir>]',
    '',
    'Runs the Wix headless scaffold non-interactively through npm create.',
    'Idempotent: safe to re-invoke against the same project (spec 0085) — adopts an',
    'existing destination receipt instead of re-scaffolding, and never spawns a second',
    'site when config/wix.env or frontend/wix.config.json already name one.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    folderName: 'frontend',
    siteTemplate: 'blank',
    projectDir: process.cwd(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--business-name':
        args.businessName = argv[i + 1];
        i += 1;
        break;
      case '--folder-name':
        args.folderName = argv[i + 1];
        i += 1;
        break;
      case '--site-template':
        args.siteTemplate = argv[i + 1];
        i += 1;
        break;
      case '--project-dir':
        args.projectDir = argv[i + 1];
        i += 1;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

async function readWixConfig(frontendDir) {
  try {
    const raw = await fs.readFile(path.join(frontendDir, 'wix.config.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.siteId === 'string' && parsed.siteId.trim() !== '') {
      return parsed;
    }
    return null;
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error instanceof SyntaxError)) {
      return null;
    }
    throw error;
  }
}

async function readWixEnvValues(wixEnvPath) {
  try {
    return await readEnvFile(wixEnvPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function isNonEmptyDir(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.length > 0;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function defaultSpawnScaffold(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', [
      '--yes',
      'create',
      '@wix/new@latest',
      '--',
      'headless',
      '--business-name',
      args.businessName,
      '--folder-name',
      args.folderName,
      '--site-template',
      args.siteTemplate,
      '--skip-install',
    ], {
      cwd: path.resolve(args.projectDir),
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      resolve({ code: signal ? 1 : (code == null ? 1 : code) });
    });
  });
}

// Removes WIX_SCAFFOLD_STATUS entirely (not just blanking its value, which config-env.js's
// upsertEnvFile cannot do and which would itself read back as a present-but-unrecognized
// value) — used only when a spawn-launch failure proves nothing could have been created,
// so the next invocation sees a genuinely untouched config/wix.env, not a lingering marker.
async function clearWixScaffoldStatus(wixEnvPath) {
  let raw;
  try {
    raw = await fs.readFile(wixEnvPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  const hadTrailingNewline = /\r?\n$/.test(raw);
  const lines = raw.split(/\r?\n/);
  if (hadTrailingNewline && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return true;
    }
    const idx = line.indexOf('=');
    return idx === -1 || line.slice(0, idx).trim() !== 'WIX_SCAFFOLD_STATUS';
  });
  const out = kept.join('\n');
  await fs.writeFile(wixEnvPath, out === '' ? '' : `${out}\n`, 'utf8');
}

// Persists WIX_SITE_ID from a confirmed receipt, re-checking for a conflict immediately
// before the write (config/wix.env can change between the top-of-invocation read and now).
// Uses statEnvKeys' placeholder-aware classification for the conflict check — PR #184
// review correction: comparing the raw value directly treated a template placeholder
// (e.g. WIX_SITE_ID=REPLACE_WITH_REAL_VALUE) as a real, conflicting destination, which
// made this throw instead of persisting on the very first scaffold of a freshly
// templated project, silently discarding the receipt this function exists to confirm.
async function persistSiteId(wixEnvPath, siteId, scaffoldStatus) {
  const currentStatus = (await statEnvKeys(wixEnvPath, ['WIX_SITE_ID'])).keys.WIX_SITE_ID;
  if (currentStatus === 'present') {
    const current = await readWixEnvValues(wixEnvPath);
    if (current.WIX_SITE_ID !== siteId) {
      throw new Error(
        `config/wix.env's WIX_SITE_ID (${current.WIX_SITE_ID}) no longer matches the scaffold's own wix.config.json (${siteId}); refusing to overwrite a different destination.`,
      );
    }
  }
  await upsertEnvFile(wixEnvPath, { WIX_SITE_ID: siteId, WIX_SCAFFOLD_STATUS: scaffoldStatus });
}

// A locally-run `npm run dev` (or equivalent) against a scaffolded
// `website`-mode project, driven from a Wix Remote Machine by any
// LLM-based coding client (Claude Code or otherwise), hits two problems
// that are properties of the PROJECT, not of any one client or run:
//
// 1. `@wix/astro`'s auto-injected middleware validates an env schema
//    (WIX_CLIENT_INSTANCE_ID etc.) that only lives in gitignored
//    `.env.local` — wiped whenever the remote machine environment
//    restarts, so the next `npm run dev` throws "MiddlewareCantBeLoaded"
//    until `.env.local` is manually regenerated via `wix env pull`. Fixed
//    durably by making the project re-pull it itself before every
//    dev/build/release, rather than assuming it survives a restart.
// 2. The dev server's own Vite config needs `server.allowedHosts` (a
//    LEADING-DOT suffix, e.g. ".remote-machine.wix-code.com" — never a
//    literal full hostname, which changes on every fresh remote-machine
//    instance and would go stale the moment it's committed) and
//    `server.host: true` (bind all interfaces) — without the latter, a
//    reverse proxy in front of the dev server can't reach it, surfacing as
//    an unexplained 504.
//
// Both are properties of the scaffolded PROJECT (checkpointed, reused
// across every future local run), not of any one invocation — so they're
// applied once, right after a destination is confirmed (see main()), not
// re-derived by hand every time this happens.
const REMOTE_MACHINE_HOST_SUFFIX = '.remote-machine.wix-code.com';
const ENV_PULL_HOOK_SCRIPTS = {
  predev: 'wix env pull',
  prebuild: 'wix env pull',
  prerelease: 'wix env pull',
};

// Same-length "search text" with every comment and string/template literal
// blanked out (non-newline characters replaced with spaces) — so none of
// the structural scanning below can mistake a `{`/`}` or a `vite`/`server`-
// shaped substring living inside a comment or string for real object
// structure. A REAL failure this caught before shipping: `// vite: {}`
// (a commented-out key, sitting elsewhere in the same object) was matched
// as if it were live, and injecting a multiline block right after its `{`
// terminated the `//` comment at the injected text's own leading newline,
// turning a perfectly valid file into one with a syntax error. Positions
// in the returned text line up EXACTLY with the input (only content is
// replaced, never length), so any offset found via the masked text is
// valid for slicing the ORIGINAL text — every call site below uses the
// masked text purely to decide WHERE things are, never to read what they
// actually say. The filler is a non-whitespace character (not a space):
// a value-span scan's trailing `\s*` must stop at the real edge of a
// masked string/comment rather than reading straight through it as if it
// were legitimate padding.
function maskCommentsAndStrings(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      const start = i;
      while (i < n && text[i] !== '\n') i += 1;
      out += text.slice(start, i).replace(/[^\n]/g, 'x');
      continue;
    }
    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i = Math.min(i + 2, n);
      out += text.slice(start, i).replace(/[^\n]/g, 'x');
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      // Template literals are blanked out WHOLESALE, `${...}` interpolation
      // included — this script has no reason to understand one, only to
      // never mistake its contents for real object structure elsewhere.
      // EXCEPTION: a quoted OBJECT KEY (`"vite": {...}`) must survive
      // masking untouched — it's the very thing keyName lookups need to
      // find — so anything immediately followed by `:` (the only shape a
      // quoted key ever takes here) is left as-is instead of blanked.
      const quote = ch;
      const start = i;
      i += 1;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') i += 1; // skip an escaped character, e.g. \' or \\
        i += 1;
      }
      i = Math.min(i + 1, n);
      let j = i;
      while (j < n && /\s/.test(text[j])) j += 1;
      if (text[j] === ':') {
        out += text.slice(start, i);
      } else {
        out += text.slice(start, i).replace(/[^\n]/g, 'x');
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// Finds the index of the `}` that closes the `{` at openBraceIndex, by
// brace-depth counting rather than a full parse. Callers pass the MASKED
// text (see maskCommentsAndStrings) so a `{`/`}` inside a comment or
// string is never miscounted as real structure; every call site below
// only acts when it found a real, load-bearing structural brace via a
// preceding regex match, and returns -1 (skip, never guess) on anything
// unbalanced.
function findMatchingBrace(text, openBraceIndex) {
  let depth = 0;
  for (let i = openBraceIndex; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Matches keyName EXACTLY — as a bare identifier with no adjoining
// identifier/hyphen characters on either side, or as a fully quoted
// key whose entire quoted content is keyName (same quote character on
// both ends, via the backreference). A plain `["']?\bkeyName["']?` (what
// this replaced) only checks for a quote immediately around keyName, so
// it isn't anchored to the KEY'S own boundaries: "legacy-vite": {...} has
// a real word boundary right before "vite" (a hyphen is a non-word
// character) and no quote is required there since it's optional, so it
// matched as though the key were "vite". Requiring an EXACT bare match or
// an exact quoted match rules that out.
function exactKeyPattern(keyName) {
  return `(?:(['"])${keyName}\\1|(?<![\\w$-])${keyName}(?![\\w$-]))`;
}

// Finds `keyName: {` (or the quoted form, `"keyName": {`/`'keyName': {'})
// as a DIRECT child of the object spanning parentOpen..parentClose
// (brace-DEPTH 1 relative to parentOpen) — never a same-named key nested
// deeper (e.g. inside a plugin call's own options object), which a plain
// "search anywhere in this span" regex would wrongly match and then
// corrupt. `text` must be the MASKED text (maskCommentsAndStrings), not
// the original source — this only ever returns POSITIONS, valid against
// either text since masking preserves length.
function findDirectChildBrace(text, parentOpen, parentClose, keyName) {
  const pattern = new RegExp(`${exactKeyPattern(keyName)}\\s*:\\s*\\{`, 'g');
  pattern.lastIndex = parentOpen + 1;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index >= parentClose) return -1;
    let depth = 0;
    for (let i = parentOpen; i < match.index; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
    }
    if (depth === 1) return match.index + match[0].length - 1;
  }
  return -1;
}

// Finds `keyName: <value>` (or the quoted key form) as a DIRECT child of
// the object spanning parentOpen..parentClose and returns { start, end }
// bounding <value>'s own source text, or 'ambiguous' if a value was found
// but its extent can't be safely bounded (an odd bracket run), or null if
// the key isn't a direct child at all. A bracketed value ([...]/{...}/
// (...)) is bounded by matching brackets; anything else runs to the next
// same-depth comma or the parent's own closing brace. `text` must be the
// MASKED text — this only ever returns POSITIONS; callers read the actual
// value text back out of the ORIGINAL source at those same positions.
function findDirectChildValueSpan(text, parentOpen, parentClose, keyName) {
  const pattern = new RegExp(`${exactKeyPattern(keyName)}\\s*:\\s*`, 'g');
  pattern.lastIndex = parentOpen + 1;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index >= parentClose) return null;
    let depth = 0;
    for (let i = parentOpen; i < match.index; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
    }
    if (depth !== 1) continue; // a same-named key nested deeper — keep looking
    const valueStart = match.index + match[0].length;
    const openChar = text[valueStart];
    if (openChar === '[' || openChar === '{' || openChar === '(') {
      const closeChar = openChar === '[' ? ']' : openChar === '{' ? '}' : ')';
      let bracketDepth = 0;
      for (let i = valueStart; i < parentClose; i += 1) {
        if (text[i] === openChar) bracketDepth += 1;
        else if (text[i] === closeChar) {
          bracketDepth -= 1;
          if (bracketDepth === 0) return { start: valueStart, end: i + 1 };
        }
      }
      return 'ambiguous';
    }
    let bracketDepth = 0;
    // INCLUSIVE of parentClose itself: a value with no trailing comma
    // right before the parent's own closing brace (the common single-line
    // case, e.g. `{ host: false }`) must have that `}` actually examined,
    // not stop one character short of it.
    for (let i = valueStart; i <= parentClose; i += 1) {
      const ch = text[i];
      if (ch === '[' || ch === '{' || ch === '(') bracketDepth += 1;
      else if (ch === ']' || ch === '}' || ch === ')') {
        if (bracketDepth === 0) return { start: valueStart, end: i }; // hit the parent's own close
        bracketDepth -= 1;
      } else if (ch === ',' && bracketDepth === 0) {
        return { start: valueStart, end: i };
      }
    }
    return 'ambiguous';
  }
  return null;
}

function quotedStringInner(valueText) {
  const match = valueText.match(/^'([^']*)'$|^"([^"]*)"$/);
  return match ? (match[1] ?? match[2]) : null;
}

// Best-effort, conservative: never touches a file it can't recognize the
// shape of. Merges into an EXISTING `vite`/`vite.server` block rather than
// skipping outright just because some unrelated vite config (e.g. plugins,
// or an unrelated nested `server:` inside a plugin's OWN options — never
// matched, since lookups here are depth-scoped to direct children only) is
// already present — a project with any of that must not be left
// permanently unpatched. Same treatment for the two settings themselves:
// presence alone isn't "already handled" — `host: false` and an
// `allowedHosts` array missing our own entry both still reproduce the
// original failure, so an already-effective VALUE is what's left alone,
// not just an already-present key. Only a value this can't safely
// interpret (some other expression — not a literal true/false/string or a
// bracketed array) is warned and left untouched rather than guessed at.
async function patchAstroConfigForRemoteMachinePreview(frontendDir) {
  const configPath = path.join(frontendDir, 'astro.config.mjs');
  let original;
  try {
    original = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.warn(`[wix-headless-scaffold] no astro.config.mjs at ${configPath} — skipping preview-host patch.`);
      return;
    }
    throw error;
  }
  // Used for ALL structural navigation below (finding keys, matching
  // braces) — never for reading actual content, which always comes from
  // `original` at the same positions (masking preserves length exactly).
  const masked = maskCommentsAndStrings(original);

  const allowedHostsComment =
    `// Any remote machine's dynamic preview hostname (the hash/port prefix\n` +
    `      // changes per session) — a literal full hostname here would go\n` +
    `      // stale the moment a remote machine restarts.\n` +
    `      `;
  const hostComment =
    `// Bind all interfaces — Vite defaults to 127.0.0.1 only, which the\n` +
    `      // platform's reverse proxy cannot reach (surfaces as a 504).\n` +
    `      `;
  const allowedHostsProp = `${allowedHostsComment}allowedHosts: ['${REMOTE_MACHINE_HOST_SUFFIX}'],`;
  const hostProp = `${hostComment}host: true,`;

  const defineMatch = masked.match(/defineConfig\(\s*\{/);
  if (!defineMatch) {
    console.warn('[wix-headless-scaffold] astro.config.mjs is not a recognizable `defineConfig({...})` — leaving it alone.');
    return;
  }
  const defineOpenBrace = defineMatch.index + defineMatch[0].length - 1;
  const defineCloseBrace = findMatchingBrace(masked, defineOpenBrace);
  if (defineCloseBrace === -1) {
    console.warn('[wix-headless-scaffold] astro.config.mjs has an unbalanced defineConfig({...}) call — leaving it alone.');
    return;
  }

  // Depth-scoped to defineConfig's OWN direct children — never a `vite:`
  // key nested inside some other option's value at any deeper level.
  const viteOpenBrace = findDirectChildBrace(masked, defineOpenBrace, defineCloseBrace, 'vite');

  let patched;
  if (viteOpenBrace === -1) {
    const insertAt = defineOpenBrace + 1;
    const injected = `\n  vite: {\n    server: {\n      ${allowedHostsProp}\n      ${hostProp}\n    },\n  },`;
    patched = original.slice(0, insertAt) + injected + original.slice(insertAt);
  } else {
    const viteCloseBrace = findMatchingBrace(masked, viteOpenBrace);
    if (viteCloseBrace === -1) {
      console.warn('[wix-headless-scaffold] astro.config.mjs has an unbalanced vite: {...} block — leaving it alone.');
      return;
    }
    // Depth-scoped to vite's OWN direct children — never a `server:` key
    // nested inside a plugin's own options within the same vite block.
    const serverOpenBrace = findDirectChildBrace(masked, viteOpenBrace, viteCloseBrace, 'server');

    if (serverOpenBrace === -1) {
      const insertAt = viteOpenBrace + 1;
      const injected = `\n    server: {\n      ${allowedHostsProp}\n      ${hostProp}\n    },`;
      patched = original.slice(0, insertAt) + injected + original.slice(insertAt);
    } else {
      const serverCloseBrace = findMatchingBrace(masked, serverOpenBrace);
      if (serverCloseBrace === -1) {
        console.warn('[wix-headless-scaffold] astro.config.mjs has an unbalanced vite.server: {...} block — leaving it alone.');
        return;
      }

      // Collected as {start, end, replacement} spans against the ORIGINAL
      // text and applied in one pass, highest offset first, so neither
      // edit invalidates the other's already-computed positions.
      const edits = [];
      let touchedSomething = false;

      const allowedHostsValue = findDirectChildValueSpan(masked, serverOpenBrace, serverCloseBrace, 'allowedHosts');
      if (allowedHostsValue === null) {
        edits.push({ start: serverOpenBrace + 1, end: serverOpenBrace + 1, replacement: `\n      ${allowedHostsProp}` });
        touchedSomething = true;
      } else if (allowedHostsValue === 'ambiguous') {
        console.warn('[wix-headless-scaffold] vite.server.allowedHosts is set to something this script cannot safely interpret — leaving it alone.');
      } else {
        const valueText = original.slice(allowedHostsValue.start, allowedHostsValue.end);
        const trimmed = valueText.trim();
        if (trimmed === 'true') {
          // Vite treats `allowedHosts: true` as "disable the check
          // entirely" — already strictly more permissive than what this
          // needs, nothing to do.
        } else if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          if (trimmed.includes(REMOTE_MACHINE_HOST_SUFFIX)) {
            // Already covers it.
          } else {
            const closeBracketAt = allowedHostsValue.start + trimmed.lastIndexOf(']');
            const beforeClose = original.slice(allowedHostsValue.start, closeBracketAt).replace(/\s+$/, '');
            const isEmpty = /\[\s*$/.test(beforeClose);
            const hasTrailingComma = /,\s*$/.test(beforeClose);
            const sep = isEmpty ? '' : hasTrailingComma ? ' ' : ', ';
            edits.push({
              start: closeBracketAt,
              end: closeBracketAt,
              replacement: `${sep}'${REMOTE_MACHINE_HOST_SUFFIX}'`,
            });
            touchedSomething = true;
          }
        } else {
          console.warn('[wix-headless-scaffold] vite.server.allowedHosts is set to something this script cannot safely interpret — leaving it alone.');
        }
      }

      const hostValue = findDirectChildValueSpan(masked, serverOpenBrace, serverCloseBrace, 'host');
      if (hostValue === null) {
        edits.push({ start: serverOpenBrace + 1, end: serverOpenBrace + 1, replacement: `\n      ${hostProp}` });
        touchedSomething = true;
      } else if (hostValue === 'ambiguous') {
        console.warn('[wix-headless-scaffold] vite.server.host is set to something this script cannot safely interpret — leaving it alone.');
      } else {
        const trimmed = original.slice(hostValue.start, hostValue.end).trim();
        const quotedInner = quotedStringInner(trimmed);
        const isIneffective = trimmed === 'false' || (quotedInner !== null && ['localhost', '127.0.0.1'].includes(quotedInner));
        const isKnownEffective = trimmed === 'true' || quotedInner !== null;
        if (isIneffective) {
          edits.push({ start: hostValue.start, end: hostValue.end, replacement: 'true' });
          touchedSomething = true;
        } else if (!isKnownEffective) {
          console.warn('[wix-headless-scaffold] vite.server.host is set to something this script cannot safely interpret — leaving it alone.');
        }
        // else: true, or a real, non-localhost bind address — already effective.
      }

      if (!touchedSomething) {
        console.log('[wix-headless-scaffold] vite.server.allowedHosts and host are already effective — nothing to patch.');
        return;
      }

      edits.sort((a, b) => b.start - a.start);
      patched = original;
      for (const edit of edits) {
        patched = patched.slice(0, edit.start) + edit.replacement + patched.slice(edit.end);
      }
    }
  }

  await fs.writeFile(configPath, patched);
  console.log('[wix-headless-scaffold] patched astro.config.mjs for remote-machine preview (allowedHosts + host).');
}

async function patchPackageJsonEnvPullHooks(frontendDir) {
  const pkgPath = path.join(frontendDir, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.warn(`[wix-headless-scaffold] no package.json at ${pkgPath} — skipping env-pull hooks.`);
      return;
    }
    throw error;
  }
  pkg.scripts = pkg.scripts || {};
  let changed = false;
  for (const [hook, command] of Object.entries(ENV_PULL_HOOK_SCRIPTS)) {
    const existing = pkg.scripts[hook];
    if (existing === undefined) {
      pkg.scripts[hook] = command;
      changed = true;
    } else if (!existing.includes(command)) {
      // A template's own hook (e.g. a codegen step) does something unrelated
      // to env-pulling — compose rather than skip, or it silently never runs
      // at all, defeating the whole point of this patch. Idempotent: a hook
      // that already contains the command is left alone, never re-composed.
      pkg.scripts[hook] = `${command} && ${existing}`;
      changed = true;
    }
  }
  if (!changed) {
    console.warn('[wix-headless-scaffold] package.json already defines all env-pull hooks — leaving it alone.');
    return;
  }
  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log('[wix-headless-scaffold] added predev/prebuild/prerelease "wix env pull" hooks to package.json.');
}

// spec 0085: safe to call more than once against the same project directory, including
// after its own prior partial failure. Every branch below either confirms a destination
// receipt before returning success, or fails closed without touching config/wix.env.
async function ensureDestinationReceipt(args, { spawnScaffold = defaultSpawnScaffold } = {}) {
  const projectDir = path.resolve(args.projectDir);
  const frontendDir = path.join(projectDir, args.folderName);
  const wixEnvPath = path.join(projectDir, 'config', 'wix.env');

  const siteIdStatus = (await statEnvKeys(wixEnvPath, ['WIX_SITE_ID'])).keys.WIX_SITE_ID;
  const envValues = await readWixEnvValues(wixEnvPath);
  const wixConfig = await readWixConfig(frontendDir);

  if (siteIdStatus === 'present') {
    // Case 1: config/wix.env already names a destination — checked first, independent of
    // wix.config.json, so an env-only receipt (adopted/existing destination, or a lost
    // frontend folder) can never fall through to spawning a second site.
    if (wixConfig && wixConfig.siteId !== envValues.WIX_SITE_ID) {
      // 1b — conflicting.
      throw new Error(
        `config/wix.env already has WIX_SITE_ID=${envValues.WIX_SITE_ID}, but ${frontendDir}/wix.config.json names a different siteId=${wixConfig.siteId}. Refusing to create or adopt a second destination — resolve the conflict manually.`,
      );
    }
    // 1a — consistent (wix.config.json is absent, has no siteId, or matches).
    const status = envValues.WIX_SCAFFOLD_STATUS;
    if (status === undefined || status === 'complete') {
      return { siteId: envValues.WIX_SITE_ID };
    }
    if (status === 'incomplete') {
      throw new Error(
        `Destination ${envValues.WIX_SITE_ID} already exists, but a prior scaffold attempt did not complete (WIX_SCAFFOLD_STATUS=incomplete). Refusing to spawn again — that would risk a duplicate site. Resolve manually before retrying.`,
      );
    }
    throw new Error(
      `config/wix.env has an unrecognized WIX_SCAFFOLD_STATUS value (${JSON.stringify(status)}); expected "complete", "incomplete", or the key to be absent. Refusing to proceed.`,
    );
  }

  // Case 2: no confirmed real WIX_SITE_ID (missing, blank, or a placeholder — all treated
  // alike here, matching case 1's classification). PR #184 review correction: this branch
  // must also inspect WIX_SCAFFOLD_STATUS, not just wix.config.json's existence — a bare
  // "wix.config.json exists" check cannot tell a genuinely legacy/host-adopted receipt
  // apart from one left behind by a scaffold attempt this script itself started but never
  // finished recording (the wrapper crashed, or was killed, after the CLI created the site
  // but before persistSiteId ran). Silently adopting the latter as "complete" is the same
  // laundering bug as case 1 exists to prevent, just reached from the opposite direction.
  const status = envValues.WIX_SCAFFOLD_STATUS;
  if (status === 'in_progress') {
    if (wixConfig) {
      // A prior invocation marked in_progress before spawning (see 2c below) and never
      // got to record a final outcome. The CLI may well have finished — never infer
      // "complete" from an orphaned receipt like this. Persist it as incomplete (the same
      // durable, fail-closed record a known non-zero exit produces) so the *next*
      // invocation adopts and blocks via case 1's existing, tested handling instead of
      // this ambiguity recurring indefinitely.
      await persistSiteId(wixEnvPath, wixConfig.siteId, 'incomplete');
      throw new Error(
        `A prior scaffold attempt was interrupted before it could record its outcome (WIX_SCAFFOLD_STATUS=in_progress), but a destination was found (WIX_SITE_ID=${wixConfig.siteId}). Persisted as incomplete — resolve manually before retrying.`,
      );
    }
    // PR #184 review correction (round 6): no local receipt either does NOT mean nothing
    // was created remotely — a crash could have happened after a remote site was created
    // but before wix.config.json was written locally (or even before the frontend folder
    // existed at all), which isNonEmptyDir below cannot detect. Fail closed
    // unconditionally rather than falling through to 2b/2c; the one case that clears this
    // marker for a safe automatic retry is a genuine spawn-launch failure (see 2c) — that
    // is handled before this marker is ever left behind, not by re-reading it here.
    throw new Error(
      'A prior scaffold attempt was interrupted before it could record any outcome (WIX_SCAFFOLD_STATUS=in_progress) and no local destination receipt (wix.config.json) exists either. This cannot be safely distinguished from a remote site having been created before a local receipt was written. Refusing to retry automatically — confirm whether a destination already exists, then either record its WIX_SITE_ID manually or clear WIX_SCAFFOLD_STATUS from config/wix.env if nothing was actually created.',
    );
  }
  if (status !== undefined) {
    // WIX_SCAFFOLD_STATUS is set to something else (a known-ambiguous marker from this
    // script, or corrupted state) while no real WIX_SITE_ID exists. Fail closed rather
    // than silently proceeding as though nothing were recorded.
    throw new Error(
      `config/wix.env has WIX_SCAFFOLD_STATUS=${JSON.stringify(status)} but no valid WIX_SITE_ID; this cannot be automatically resolved. Refusing to proceed automatically — resolve manually.`,
    );
  }

  if (wixConfig) {
    // 2a — adopt a receipt with no status marker at all: a genuinely legacy/host-adopted
    // destination, or one scaffolded before this script wrote WIX_SCAFFOLD_STATUS.
    await upsertEnvFile(wixEnvPath, { WIX_SITE_ID: wixConfig.siteId, WIX_SCAFFOLD_STATUS: 'complete' });
    return { siteId: wixConfig.siteId };
  }

  if (await isNonEmptyDir(frontendDir)) {
    // 2b — genuinely ambiguous state this script cannot resolve on its own.
    throw new Error(
      `${frontendDir} already exists and is not empty, but no valid wix.config.json was found there and config/wix.env has no WIX_SITE_ID. Refusing to scaffold into this folder automatically — resolve manually before retrying.`,
    );
  }

  // 2c — nothing exists yet; mark in_progress before spawning so a crash between now and
  // persisting a final outcome always leaves a distinguishable trace instead of silently
  // looking like "nothing was ever attempted."
  await upsertEnvFile(wixEnvPath, { WIX_SCAFFOLD_STATUS: 'in_progress' });
  let code;
  try {
    ({ code } = await spawnScaffold(args));
  } catch (spawnError) {
    // A rejection alone isn't proof nothing was created — spawnScaffold could fail for
    // reasons other than a launch failure after the child already did real work. Check for
    // a receipt regardless of why this rejected: if one exists, leave the in_progress
    // marker in place so the next invocation's self-heal branch above handles it (never
    // clear a marker out from under a receipt that might exist). Only when there is
    // genuinely no receipt is it safe to clear — for the real spawnScaffold, which only
    // rejects via child_process's 'error' event (emitted specifically when the OS-level
    // process itself could never be launched, before any exit code exists), that absence
    // is deterministic: nothing could have been created remotely.
    const orphanedConfig = await readWixConfig(frontendDir);
    if (!orphanedConfig) {
      await clearWixScaffoldStatus(wixEnvPath);
    }
    throw spawnError;
  }
  const postConfig = await readWixConfig(frontendDir);
  if (postConfig) {
    // Persisted even on a non-zero exit: site creation and later template/release work are
    // separate phases of the CLI's run, so discarding the id here is exactly how a retry
    // would spawn a second site.
    await persistSiteId(wixEnvPath, postConfig.siteId, code === 0 ? 'complete' : 'incomplete');
    if (code === 0) {
      return { siteId: postConfig.siteId };
    }
    throw new Error(
      `Scaffold process exited with code ${code}, but a destination was created (WIX_SITE_ID=${postConfig.siteId}); persisted as incomplete. Do not retry automatically — resolve the underlying failure first.`,
    );
  }
  // The child process definitely ran to completion (it returned an exit code), but no
  // valid local receipt was found. This must NOT be left as a retryable in_progress
  // marker: a remote site could still have been created before a local write failed.
  // Convert it to a durable, always-blocked marker instead.
  await upsertEnvFile(wixEnvPath, { WIX_SCAFFOLD_STATUS: 'ambiguous' });
  if (code === 0) {
    throw new Error('Scaffold process exited 0, but no wix.config.json with a siteId was found afterward — cannot confirm whether a destination was created. Marked ambiguous; resolve manually before retrying.');
  }
  throw new Error(`Scaffold process exited with code ${code} and no destination receipt was found — cannot confirm whether a destination was created. Marked ambiguous; resolve manually before retrying.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.businessName) {
    console.error(usage());
    process.exit(1);
    return;
  }
  const result = await ensureDestinationReceipt(args);
  // Applied after ANY successful resolution (a fresh scaffold, or an
  // idempotent adopt of an existing receipt) — both patch functions are
  // themselves idempotent and cheap, so an already-patched or pre-existing
  // destination is a safe, fast no-op, not just the first-scaffold path.
  const frontendDir = path.join(path.resolve(args.projectDir), args.folderName);
  await patchAstroConfigForRemoteMachinePreview(frontendDir);
  await patchPackageJsonEnvPullHooks(frontendDir);
  console.log(JSON.stringify({ ok: true, siteId: result.siteId }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  ensureDestinationReceipt,
  parseArgs,
  usage,
  patchAstroConfigForRemoteMachinePreview,
  patchPackageJsonEnvPullHooks,
};
