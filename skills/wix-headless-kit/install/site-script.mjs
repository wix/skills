#!/usr/bin/env node
// Load the site's Wix scripts on a non-Astro frontend: Wix Analytics, the cookie-consent banner, the
// owner's marketing tags and custom code, and the SEO tags edited in the dashboard. On the Astro
// stack `@wix/astro` injects them; static pages and a bundler's index.html get them from one loader
// tag before </head>, which mints its own visitor token from the public clientId and fetches the
// page's scripts. The page's own <title>, <meta> and <link> tags win; JSON-LD always goes in.
//
//   node <SKILL_ROOT>/install/site-script.mjs <dir> [--client-id <id>]
//
// Every .html under <dir> gets the tag; a tag already there with another clientId (a dropped site's
// download) is replaced. Run it from the project root after the pages are written and before the
// release. Prints { dir, clientId, pages, added, replaced, unchanged }.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { siteContext } from "./context.mjs";

const LOADER = "https://manage.wix.com/_api/headless-business-setup/v1/headless-business/site-script.js";
const TAG = /<script\b[^>]*\bid=["']wix-site-script["'][^>]*>\s*<\/script>\s*/i;

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--client-id");
if (!dir) {
  console.log(JSON.stringify({ error: "usage: site-script.mjs <dir> [--client-id <id>] — the folder the release uploads (site/, public/, the build output)" }));
  process.exit(1);
}
const clientId = flag("client-id") ?? siteContext({ pull: false }).content.clientId;
if (!clientId) {
  console.log(JSON.stringify({ error: "no clientId: none in .env.local or wix.config.json — pass --client-id" }));
  process.exit(1);
}

const tag = `<script id="wix-site-script" src="${LOADER}" data-client-id="${clientId}" async></script>`;
const pages = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".html")) pages.push(p);
  }
};
walk(dir);

const result = { dir, clientId, pages: pages.length, added: [], replaced: [], unchanged: [] };
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const rel = relative(dir, page);
  const existing = html.match(TAG)?.[0];
  if (existing && existing.includes(`data-client-id="${clientId}"`)) { result.unchanged.push(rel); continue; }
  const stripped = existing ? html.replace(TAG, "") : html;
  const at = stripped.search(/<\/head>/i);
  if (at < 0) { result.unchanged.push(`${rel} (no </head>)`); continue; }
  writeFileSync(page, `${stripped.slice(0, at)}${tag}\n${stripped.slice(at)}`);
  (existing ? result.replaced : result.added).push(rel);
}
console.log(JSON.stringify(result));
