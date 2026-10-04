// The shared runner behind every vertical's `seed/read-site.mjs` — the build-time read of what a
// site holds, so the agent sizes the content without composing a single Wix request.
//
//   node <SKILL_ROOT>/templates/<vertical>/seed/read-site.mjs [--site <siteId>] [--limit <n>]
//
// The site is `--site`, else the project's content site (./wix.config.json, or the parent named in
// .env.local on a migration preview). The token is minted by the Wix CLI
// inside this process and never written anywhere. Output is ONE JSON object on stdout:
//   { vertical, siteId, installed, ...what the vertical reads..., calls: [{ method, path, status, docs }] }
// `calls` lists every request made, with the method's documentation URL — open one of those (the
// URL plus `.md` is the full page) when the brief needs more than the summary shows. A failed call
// is reported in `calls` with its status and message; the reader continues and marks the field null.
import { existsSync } from "node:fs";
import { contentSiteId } from "./site-context.mjs";
import { wixToken } from "./wix-cli.mjs";

const API = "https://www.wixapis.com";
const DOCS_INSTALLED_APPS = "https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/get-installed-apps";

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
}

export function siteIdFromArgsOrConfig() {
  const fromFlag = flag("site");
  if (fromFlag) return fromFlag;
  // The CONTENT site: the config's site, or the parent of a migration preview (site-context.mjs).
  return existsSync("wix.config.json") ? contentSiteId() : null;
}

export function makeApi(siteId) {
  const token = wixToken(siteId);
  const calls = [];
  async function call({ method = "POST", path, body, docs }) {
    const entry = { method, path: path.split("?")[0], docs };
    calls.push(entry);
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: token, "wix-site-id": siteId, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    entry.status = res.status;
    if (!res.ok) {
      entry.error = text.slice(0, 200) || "(empty body)";
      const e = new Error(`${method} ${entry.path} → ${res.status}: ${entry.error}`);
      e.status = res.status;
      throw e;
    }
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  }
  // Same call, but a failure becomes null and stays in `calls` — for reads whose absence is data.
  async function tryCall(opts) {
    try { return await call(opts); } catch { return null; }
  }
  async function installed(appId) {
    const r = await tryCall({ method: "GET", path: "/apps-installer-service/v1/app-instances", docs: DOCS_INSTALLED_APPS });
    if (!r) return null;
    return (r.appInstances ?? []).some((a) => a.appDefId === appId || a.appId === appId);
  }
  return { call, tryCall, installed, calls };
}

export const limit = () => Number(flag("limit") ?? 12);

// read(api, { limit }) returns the vertical's summary; the runner adds the envelope and prints.
export async function runReader({ vertical, appId, read }) {
  const siteId = siteIdFromArgsOrConfig();
  if (!siteId) {
    console.log(JSON.stringify({ error: "no site: pass --site <siteId> or run in a folder with wix.config.json" }));
    process.exit(1);
  }
  const api = makeApi(siteId);
  const out = { vertical, siteId, scope: null };
  out.installed = appId ? await api.installed(appId) : undefined;
  let data = {};
  if (out.installed === false) {
    out.scope = `${vertical}: the app is not installed on this site — nothing to read; the vertical's seed installs it`;
  } else {
    try { data = await read(api, { limit: limit() }); }
    catch (e) { out.error = String(e.message).slice(0, 300); }
  }
  // What this output is and is not: a SIZING. Every list is a sample page; the counts are the site.
  const partial = Object.entries(data)
    .filter(([k, v]) => Array.isArray(v) && typeof data[`${k.replace(/s$/, "")}Count`] === "number" && data[`${k.replace(/s$/, "")}Count`] > v.length)
    .map(([k, v]) => `${k}: ${v.length} of ${data[`${k.replace(/s$/, "")}Count`]} shown`);
  if (!out.scope) {
    out.scope = "A sizing, not the content. Lists are one page (--limit, max 100); counts are the whole site. " +
      (partial.length ? `Partial here: ${partial.join("; ")}. ` : "") +
      "The pages read everything live through the deployed data layer. To read more or filter, page the same call: its method and documentation URL are in `calls`.";
  }
  Object.assign(out, data);
  out.calls = api.calls;
  out.docs = [...new Set(api.calls.map((c) => c.docs).filter(Boolean))];
  console.log(JSON.stringify(out, null, 2));
}
