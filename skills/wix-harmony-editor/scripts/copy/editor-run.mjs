#!/usr/bin/env node
// Run one editor-API snippet from a file in the open Harmony editor and print its result.
//
//   node scripts/copy/editor-run.mjs <snippet.js> [--site <metaSiteId>] [--max 20000] [--capabilities caps.json]
//
// The snippet is the body of an async function with `editorLLMApis` in scope; `return`
// its result. Keeping snippets in files avoids shell-quoting bugs and leaves a replayable
// record of every write. Prints the parsed `result` on success, or the editor's failure
// summary (which lists completed writes: never re-run those, continue from the failed call).
import { chromium } from 'playwright';
import { hideScrollbars } from './hide-scrollbars.mjs';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!file) { console.error('usage: editor-run.mjs <snippet.js> [--site <metaSiteId>] [--max 20000]'); process.exit(2); }
const site = opt('site', null);
const max = Number(opt('max', 20000));
// lint the snippet against the editor's API list before sending (compliance guard 1b)
const capsFile = opt('capabilities', process.env.HARMONY_CAPABILITIES || null);
if (capsFile) {
  const { lintApi } = await import('./lint-api.mjs');
  const { problems } = lintApi(fs.readFileSync(file, 'utf8'), JSON.parse(fs.readFileSync(capsFile, 'utf8')), file, { snippet: true });
  for (const p of problems) console.error(`ERROR ${p.at}: ${p.error || p.warning}`);
  if (problems.some((p) => p.error)) { console.error('Not sent: fix the unknown API calls or non-API operations (or refresh the snapshot).'); process.exit(4); }
} else console.error('note: no --capabilities / HARMONY_CAPABILITIES given: the snippet is not linted against the editor API list');

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.PW_PORT || 9333}`);
const page = browser.contexts().flatMap((c) => c.pages())
  .find((p) => p.url().includes('editor.wix.com/edit/') && (!site || p.url().includes(site)));
if (!page) { console.error('No authenticated Harmony editor page is open' + (site ? ` for ${site}` : '') + '.'); process.exit(3); }
await hideScrollbars(page); // canvas widths must not depend on the OS scrollbar setting
const raw = await page.evaluate(async (code) => {
  const api = await repluggableAppDebug.host.getAPI({ name: 'RunEditorLLMCodeToolAPI', public: true, layer: 'DATA_SERVICE' });
  try { return await api.execute({ code }, { biParams: {} }); } catch (e) { return { thrown: String((e && e.message) || e) }; }
}, fs.readFileSync(file, 'utf8'));
let printed;
try {
  const content = JSON.parse(raw.items[0].content);
  printed = content.success ? content.result : { success: false, summary: content.summary, completedCalls: content.completedCalls, failedCall: content.failedCall };
} catch { printed = raw; }
const text = typeof printed === 'string' ? printed : JSON.stringify(printed);
console.log(text.length > max ? `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]` : text);
await browser.close();
