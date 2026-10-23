#!/usr/bin/env node
// Static check of editor code before it reaches the editor (compliance guard 1b).
// Every `A.<namespace>.<method>(` / `editorLLMApis.<namespace>.<method>(` call in the given
// files must exist in the live editor's API list, as recorded by snapshot-capabilities.mjs
// (`api`). In a snippet, anything else (fetch, require, import(),
// eval, window/document access) is an error too. Exit 1 on any unknown call.
//
//   node scripts/copy/lint-api.mjs --capabilities capabilities.json [--snippet] <file.js|file.mjs> [...]
//   --snippet: the file is editor code itself (not a Node script): also reject fetch/require/window/…
//
// Also used by editor-run.mjs (every snippet) and check-description.mjs (deploy-description.mjs
// is linted with its generated snippets, since they are template strings in that file).
import fs from 'fs';
import { fileURLToPath } from 'url';

const CALL = /\b(?:A|editorLLMApis)\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g;
const OUTSIDE = /\b(fetch|require|eval|XMLHttpRequest|importScripts)\s*\(|\bimport\s*\(|\b(window|document|localStorage|process)\./g;

// snippet: true for a file that IS editor code (editor-run input); host scripts only get the API-method check
export function lintApi(code, caps, file = 'snippet', { snippet = false } = {}) {
  const api = caps?.api;
  const problems = [];
  const lines = code.split('\n');
  const where = (i) => `${file}:${code.slice(0, i).split('\n').length}`;
  if (!api) return { problems: [{ at: file, error: 'capabilities file has no `api` list: re-run snapshot-capabilities.mjs' }], calls: 0 };
  let calls = 0;
  for (const m of code.matchAll(CALL)) {
    calls++;
    const [, ns, method] = m;
    if (!api[ns]) problems.push({ at: where(m.index), error: `unknown namespace '${ns}' (editor has: ${Object.keys(api).join(', ')})` });
    else if (!api[ns].includes(method)) problems.push({ at: where(m.index), error: `'${ns}.${method}' does not exist; '${ns}' has: ${api[ns].join(', ')}` });
  }
  if (snippet) for (const m of code.matchAll(OUTSIDE)) {
    const line = lines[code.slice(0, m.index).split('\n').length - 1].trim();
    if (/^\s*(\/\/|\*)/.test(line) || /^import\b/.test(line)) continue; // comments and the script's own module imports
    problems.push({ at: where(m.index), error: `'${m[0].trim()}' is not part of the editor API: a snippet may only call editorLLMApis` });
  }
  return { problems, calls };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--capabilities');
  const capsFile = ci >= 0 ? args[ci + 1] : null;
  const snippet = args.includes('--snippet');
  const files = args.filter((a, i) => !a.startsWith('--') && i !== ci + 1);
  if (!capsFile || !files.length) { console.error('usage: lint-api.mjs --capabilities capabilities.json <file> [...]'); process.exit(2); }
  const caps = JSON.parse(fs.readFileSync(capsFile, 'utf8'));
  let bad = 0;
  for (const f of files) {
    const { problems, calls } = lintApi(fs.readFileSync(f, 'utf8'), caps, f, { snippet });
    for (const p of problems) { console.log(`${p.error ? 'ERROR' : 'warn '} ${p.at}: ${p.error || p.warning}`); if (p.error) bad++; }
    console.log(`${f}: ${calls} API calls, ${problems.filter((p) => p.error).length} errors`);
  }
  process.exit(bad ? 1 : 0);
}
