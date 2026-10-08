// Install the Wix Site Search app on the project's site — the one site mutation the site-search
// capability needs, and the one thing its deploy does not do. A BUILD-TIME script, never shipped.
// Run from the project root (where wix.config.json lives), AFTER the content seed:
//
//   node <SKILL_ROOT>/templates/shared/capabilities/site-search/seed/install.mjs [--site <siteId>]
//
// The site is --site, else wix.config.json's siteId. The token is minted by the Wix CLI inside this
// process and never written anywhere. Prints ONE JSON object: { siteId, appId, installed: "now" |
// "already", indexing }. The install back-fills the site's existing products, services, posts and
// events; results appear about half a minute later — smoke-test with the deployed data layer
// (searchAll("<a seeded title word>")) and expect a non-empty group before wiring the UI. Zero
// documents after a minute means the app is not installed or the content is not visible to the
// index (hidden products, drafts), not that the query is wrong.
import { execFileSync } from "node:child_process";
import { seedSiteId } from "../../../seed/site-context.mjs";
import { existsSync, readFileSync } from "node:fs";
import { installSiteSearch } from "../../../seed/site.mjs";

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
}

// --site, else the project's content site (wix.config.json, or the site being migrated on a
// migration preview — where installing an app is a write into the live original: the guard applies).
let siteId = flag("site");
if (!siteId && existsSync("wix.config.json")) siteId = seedSiteId({ argv: process.argv });
if (!siteId) {
  console.log(JSON.stringify({ error: "no site: pass --site <siteId> or run in a folder with wix.config.json" }));
  process.exit(1);
}
const token = execFileSync("npx", ["-y", "@wix/cli@1.1.258", "token", "--site", siteId], { encoding: "utf8" }).trim();
if (!token) {
  console.log(JSON.stringify({ error: "the Wix CLI returned no token — run `npx @wix/cli@1.1.258 login` first" }));
  process.exit(1);
}
try {
  const r = await installSiteSearch({ token, siteId });
  console.log(JSON.stringify({ siteId, ...r, indexing: r.installed === "now" ? "existing content is being indexed; expect results within about half a minute" : "already indexed" }));
} catch (e) {
  console.log(JSON.stringify({ siteId, error: String(e.message).slice(0, 400) }));
  process.exit(1);
}
