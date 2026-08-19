// Wix docs helpers for the Base44 sandbox — run via exec_tool, never shipped in the app.
// The mechanics that keep breaking when retyped live here once: the byte budget on every
// return, the .md suffix, the filtered-browse rule, the docsUrl (not operationId) match.
//
// INVARIANT: no function returns more than ~4,000 chars into a tool result. Anything bigger
// is written to the scratch dir and you get { path, bytes } back — read it with read_file.
//
// Usage (exec_tool; require() can return empty exports for build-time files — load by eval):
//   const fs = require("fs");
//   const docs = (() => { const m = { exports: {} };
//     new Function("module", "exports", "require",
//       fs.readFileSync("/app/.agents/skills/wix-docs-base44/scripts/docs.js", "utf8"))(m, m.exports, require);
//     return m.exports; })();
//
//   return await docs.browse({ menuUrl: ".../business-solutions/bookings/bookings",
//                              nameFilter: "resched" });
//
// If a response shape surprises you, read this file and hand-roll the call — the functions
// are thin; the raw endpoints are documented in SKILL.md. Never guess an API from memory.

const fs = require("fs");
const path = require("path");

const SEARCH_API = "https://www.wixapis.com/mcp-docs-search/v1/docs";
const SPEC_API = "https://mcp.wix.com/api/code-mode/search";
const BUDGET = 4000; // chars a function may return inline; results are clipped at ~5,000

// Everything this module saves lands inside the installed skill, next to this file —
// .agents/skills/wix-docs-base44/scratch/ — so fetched docs live with the skill, not in src/.
// Returned paths are workspace-relative: read them with read_file exactly as returned.
const SCRATCH_REL = ".agents/skills/wix-docs-base44/scratch";

function scratchDir() {
  const dir = path.join(process.cwd(), SCRATCH_REL);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function save(name, text) {
  const file = path.join(scratchDir(), name);
  fs.writeFileSync(file, text);
  return { path: SCRATCH_REL + "/" + name, bytes: fs.statSync(file).size };
}

function readScratch(name) {
  return fs.readFileSync(path.join(scratchDir(), name.replace(SCRATCH_REL + "/", "")), "utf8");
}

// Trim a {…, hits/rows: [...]} payload to the budget; `omitted` > 0 means narrow and re-run.
function budgeted(rows, base = {}) {
  let used = JSON.stringify(base).length;
  const shown = [];
  for (const r of rows) {
    const n = JSON.stringify(r).length + 2;
    if (used + n > BUDGET) break;
    shown.push(r);
    used += n;
  }
  return { ...base, shown: shown.length, omitted: rows.length - shown.length, rows: shown };
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

// ── find ─────────────────────────────────────────────────────────────────────

// Browse the REST docs tree. Deterministic — use this before search when you know the product.
// Filtered (nameFilter, or include without METHOD) stays inline; an unfiltered method listing
// of a vertical is ~30 KB and goes to disk automatically.
async function browse({ menuUrl, include, nameFilter, depth, saveAs } = {}) {
  const body = { document_type: "REST" };
  if (menuUrl) body.menu_url = menuUrl;
  if (include) body.include = include;
  if (nameFilter) body.name_filter = nameFilter;
  if (depth) body.depth = depth;
  let content;
  try {
    ({ content } = await post(`${SEARCH_API}/menu/browse`, body));
  } catch (e) {
    if (/-> 404/.test(e.message)) {
      return { exists: false, error: e.message.slice(0, 200),
               hint: "menu_url is not a docs node — use a URL from a previous response; re-orient a level up" };
    }
    throw e;
  }
  if (content == null) {
    return { exists: false, hint: "empty content — re-orient a level up" };
  }
  if (saveAs || content.length > BUDGET) {
    return { ...save((saveAs || "browse") + ".md", content), note: "over budget — read with read_file" };
  }
  return { content };
}

// Semantic search → disk. Ranks, never matches: it always returns something, and the top hit
// can be another product — check each URL's vertical, and never treat results as proof of absence.
async function search(term, { type = "REST", max = 5, lines = 20, saveAs = "search-1" } = {}) {
  const { content } = await post(`${SEARCH_API}/search/markdown`, {
    search_term: term, document_type: type, maximum_results: max, lines_in_each_result: lines,
  });
  const urls = [...new Set(content.match(/https:\/\/dev\.wix\.com\/docs\/[^\s)"'\]]+/g) || [])];
  return { ...save(saveAs + ".md", content), urls: urls.slice(0, 25) };
}

// ── fetch ────────────────────────────────────────────────────────────────────

// Fetch one docs page as markdown (the .md suffix is appended for you — without it the portal
// serves a multi-MB HTML shell). Returns { path, bytes, status }; read it via map/sections.
async function fetchDoc(url, slug) {
  const mdUrl = url.replace(/\.md$/, "").replace(/\?.*$/, "") + ".md";
  const res = await fetch(mdUrl);
  const body = await res.text();
  if (!res.ok) {
    // A 404 body saved as a doc reads as a doc — a composed URL must fail loudly instead.
    return { exists: false, status: res.status, url: mdUrl, body: body.slice(0, 200),
             hint: "not a docs page — take URLs from browse/search output, do not compose them" };
  }
  const name = (slug || mdUrl.split("/").pop().replace(/\.md$/, "")) + ".md";
  return { ...save(name, body), status: res.status };
}

// ── read ─────────────────────────────────────────────────────────────────────

// Line numbers of every match + every section header, byte-budgeted.
// omitted > 0 → narrow the regex and map again; never read on past an unseen tail.
function mapTerms(slug, regex) {
  const name = slug.endsWith(".md") ? slug : slug + ".md";
  const lines = readScratch(name).split("\n");
  const hits = [];
  lines.forEach((text, i) => {
    if (/^#{1,3} /.test(text) || regex.test(text)) hits.push({ line: i + 1, text: text.trim().slice(0, 100) });
  });
  // `file` rides every return so the read_file path is always in the latest tool result —
  // hand-reconstructed paths are how src/-prefixed reads fail.
  return budgeted(hits, { file: SCRATCH_REL + "/" + name.replace(SCRATCH_REL + "/", ""), lines: lines.length });
}

// The page outline with read_file coordinates precomputed. Every method page is an intro then
// two parallel halves — REST and SDK — each with its own Schema and Examples. limit <= 3 is a
// container (read its children); camelCase example titles are SDK, English titles are REST.
function sections(slug) {
  const name = slug.endsWith(".md") ? slug : slug + ".md";
  const lines = readScratch(name).split("\n");
  const heads = [];
  lines.forEach((text, i) => {
    if (/^#{1,3} /.test(text)) heads.push({ line: i + 1, text: text.trim().slice(0, 80) });
  });
  const rows = heads.map((h, j) => ({
    text: h.text, offset: h.line - 1,
    limit: (heads[j + 1]?.line ?? lines.length + 1) - h.line,
  }));
  return budgeted(rows, { file: SCRATCH_REL + "/" + name.replace(SCRATCH_REL + "/", ""), lines: lines.length });
}

// ── enumerate (the "does it exist?" calls) ──────────────────────────────────

// Every method of a resource, from the API spec index. Matches the resource's docsUrl —
// operationIds are fully qualified and a resource name never matches them.
async function methodsOf(resourcePattern) {
  const fn = `async function(){
    const re = new RegExp(${JSON.stringify(resourcePattern)}, "i");
    const rs = lightIndex.filter(x => re.test(x.docsUrl || ""));
    return rs.map(r => ({ docsUrl: r.docsUrl,
      methods: r.methods.map(m => ({ op: m.operationId.split(".").pop(), verb: m.httpMethod })) }));
  }`;
  const { result } = await post(SPEC_API, { code: fn });
  if (!result || !result.length) return { exists: false, hint: "no resource docsUrl matches — browse the vertical to find the real path" };
  return budgeted(result.flatMap(r => r.methods.map(m => ({ ...m, resource: r.docsUrl.split("/").pop() }))),
    { resources: result.map(r => r.docsUrl) });
}

// ── call (the docs were the map; this is the territory) ─────────────────────

// Call a Wix API whose contract you just read. `token` is a bearer — the connector's
// (admin) or a visitor's. API responses are site data and stay OUT of scratch (scratch
// is committed with the app); an oversized response comes back clipped and says so —
// narrow the call (filters, paging, fields) rather than re-requesting the same size.
async function callApi({ url, method = "POST", token, body }) {
  const res = await fetch(url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) return { status: res.status, error: text.slice(0, 300) };
  if (text.length > BUDGET) {
    return { status: res.status, truncated: true, totalChars: text.length, text: text.slice(0, BUDGET),
             hint: "narrow the call — filters, cursor paging, or fewer fields" };
  }
  try { return { status: res.status, json: JSON.parse(text) }; }
  catch { return { status: res.status, text }; }
}

// THE way to read a schema: write a query over the API spec index. In scope:
//   lightIndex — Array<{ name, resourceId, docsUrl, menuPath: string[],
//                        methods: [{ operationId, summary, httpMethod,
//                                    path,       // PARTIAL — never call it
//                                    publicUrl,  // the executable wixapis.com URL — call THIS
//                                    docsUrl, description }] }>
//   getResourceSchemaByUrl(docsUrl) — the full resource schema: .methods (requestBody at
//     m.requestBody.content["application/json"].schema; { "$circular": "<name>" } stubs
//     resolve via .components.schemas["<name>"]). API pages only — skill/article pages
//     have no schema.
// This is an INSPECT tool, not discovery: arrive with a docsUrl from browse/search, then
// find the exact entry by docsUrl. Substring-filtering lightIndex has no ranking, matches
// only resource names, and returns [] on the wrong field — an empty result means your
// query missed the shape, not that the API is absent.
// Schemas are huge; return only the slice you need and ITERATE — each call is one round,
// refine the query instead of returning more. Small results come back inline; a big one is
// saved to scratch (public docs — allowed) as { path, bytes } to read with read_file.
async function specQuery(fnBody, { saveAs } = {}) {
  const { result } = await post(SPEC_API, { code: fnBody });
  const text = JSON.stringify(result, null, 1);
  if (saveAs || text.length > BUDGET) return save((saveAs || "spec-query") + ".json", text);
  return { result };
}

module.exports = { browse, search, fetchDoc, mapTerms, sections, methodsOf, callApi, specQuery };
