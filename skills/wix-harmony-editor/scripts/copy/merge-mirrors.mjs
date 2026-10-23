#!/usr/bin/env node
// Merge mirrors captured in parallel (mirror-site.mjs into separate directories) into one.
//
//   node scripts/copy/merge-mirrors.mjs <intoDir> <fromDir> [<fromDir> ...]
//
// A capture takes ~25 s per page: split a long URL list over several directories, run them at once, merge.
// resources / embeds: the first entry for a URL wins; pages and captured are unioned; bodies (named by hash)
// are copied when missing. <intoDir> may be one of the sources' ancestors' mirror: it is created if absent.
import fs from 'fs';

const [into, ...from] = process.argv.slice(2);
if (!into || !from.length) { console.error('usage: merge-mirrors.mjs <intoDir> <fromDir...>'); process.exit(2); }
fs.mkdirSync(`${into}/bodies`, { recursive: true });
const file = `${into}/index.json`;
const out = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { site: null, pages: [], resources: {}, embeds: {} };
out.embeds ??= {}; out.captured ??= [];
let copied = 0, added = 0;
for (const dir of from) {
  const idx = JSON.parse(fs.readFileSync(`${dir}/index.json`, 'utf8'));
  out.site ??= idx.site;
  if (idx.site !== out.site) { console.error(`${dir} mirrors ${idx.site}, not ${out.site}`); process.exit(1); }
  for (const [u, r] of Object.entries(idx.resources)) if (!out.resources[u]) { out.resources[u] = r; added++; }
  for (const [u, e] of Object.entries(idx.embeds || {})) out.embeds[u] ??= e;
  out.pages = [...new Set([...out.pages, ...idx.pages])];
  out.captured = [...new Set([...out.captured, ...(idx.captured || [])])];
  if (fs.existsSync(`${dir}/bodies`)) for (const b of fs.readdirSync(`${dir}/bodies`)) if (!fs.existsSync(`${into}/bodies/${b}`)) { fs.copyFileSync(`${dir}/bodies/${b}`, `${into}/bodies/${b}`); copied++; }
}
fs.writeFileSync(file, JSON.stringify(out));
console.log(JSON.stringify({ into, pages: out.pages.length, captured: out.captured.length, resources: Object.keys(out.resources).length, newResources: added, bodiesCopied: copied }));
