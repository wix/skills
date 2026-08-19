// Wix docs helpers for the Base44 sandbox — the scratch-lane set. Small results return
// inline; anything over ~4,000 chars (exec results clip at ~5,000) is saved under the
// scratch dir and comes back as { path, bytes, lines, outline } with the read tools
// pre-pointed at it.
//
// Load per exec (execs share no state):
//   const src = await (await fetch("https://www.wix.com/skills/wix-docs-base44/scripts/disk.js")).text();
//   const wx = (() => { const m = { exports: {} };
//     new Function("module", "exports", "require", src)(m, m.exports, require); return m.exports; })();
//
// Read a saved file three ways — wx.grep(ref, /term/) numbered hits, wx.window(ref, a, b)
// verbatim lines, wx.fields(ref, a, b) a fenced example's field vocabulary. `ref` is the
// returned path OR the original URL (it resolves either). The shell works on the paths
// too: grep -n 'term' <path> · sed -n 'a,bp' <path> (GNU grep/sed; awk is mawk; no rg),
// and read_file takes them with a 45K cap.
//
// API responses are site data and stay OUT of scratch (scratch ships with the app):
// post() never saves — project responses to facts.

const fs = require("fs");
const path = require("path");

const BUDGET = 4000;
const SCRATCH = ".agents/skills/wix-docs-base44/scratch";

const clip = (out) => {
  const s = typeof out === "string" ? out : JSON.stringify(out);
  return s.length <= BUDGET ? out : { truncated: true, total: s.length, head: s.slice(0, BUDGET) };
};

// One transport for every JSON call — Content-Type, optional Bearer, ok-guard.
// Admin calls are this with the connector token: post(publicUrl, body, accessToken).
async function post(url, body, token) {
  const r = await fetch(url, { method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) } });
  if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 300));
  return r.json();
}

function save(name, text) {
  const dir = path.join(process.cwd(), SCRATCH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
  return { path: SCRATCH + "/" + name, bytes: Buffer.byteLength(text), lines: text.split("\n").length };
}

const outlineOf = (lines, cap = 30) => {
  const heads = [];
  lines.forEach((t, i) => { if (/^#{1,3} /.test(t)) heads.push({ line: i + 1, text: t.trim().slice(0, 80) }); });
  return { outline: heads.slice(0, cap), outlineOmitted: Math.max(0, heads.length - cap) };
};

// A ref is a scratch path or the URL it came from — resolve to lines, fetching+saving
// URLs on first touch (the .md suffix is appended for extensionless docs URLs).
const slugOf = (url) => url.replace(/\?.*$/, "").split("/").pop().replace(/\.md$/, "") + ".md";
async function resolveRef(ref) {
  const isUrl = /^https?:/.test(ref);
  const name = isUrl ? slugOf(ref) : ref.split("/").pop();
  const file = path.join(process.cwd(), SCRATCH, name);
  if (fs.existsSync(file)) return { path: SCRATCH + "/" + name, lines: fs.readFileSync(file, "utf8").split("\n") };
  if (!isUrl) throw new Error("no such scratch file: " + ref + " — pass a returned path or the source URL");
  const mdUrl = /\.[a-z]{2,5}$/.test(ref.replace(/\?.*$/, "")) ? ref : ref.replace(/\?.*$/, "") + ".md";
  const res = await fetch(mdUrl);
  if (!res.ok) throw new Error(res.status + " on " + mdUrl + " — not a docs page; take URLs from output, don't compose");
  const text = await res.text();
  const saved = save(name, text);
  return { path: saved.path, lines: text.split("\n") };
}

// ── gather context ────────────────────────────────────────────────────────────

// The dynamic context report — site data, never saved. No section → its header
// outline; with one → that section's text. Empty report = bad token, never an empty site.
async function context(token, section) {
  const { markdown } = await post(
    "https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown", {}, token);
  if (!section) return clip({ total: markdown.length, ...outlineOf(markdown.split("\n"), 60) });
  const m = markdown.match(new RegExp("^#{1,3} .*" + section + "[\\s\\S]*?(?=\\n#{1,3} |$)", "im"));
  return clip({ total: markdown.length, section: m ? m[0] : "not found — call context(token) for the outline" });
}

// ── find what to read ─────────────────────────────────────────────────────────

// Browse the docs tree — deterministic. menuUrl alone orients (children + counts);
// filter before listing methods. An oversized listing is saved with its outline.
async function browse(menuUrl, { include, filter, depth } = {}) {
  const { content } = await post("https://www.wixapis.com/mcp-docs-search/v1/docs/menu/browse", {
    menu_url: menuUrl, ...(include && { include }),
    ...(filter && { name_filter: filter }), ...(depth && { depth }),
  });   // 404 "No menu node found" ⇒ re-orient a level up
  if (content.length <= BUDGET) return content;
  return { ...save("browse.md", content),
           next: "one line per node — wx.grep(path, /term/) it, or re-browse with a filter" };
}

// Semantic search — ranks, never says "no match". The reduced hits come back inline
// AND the full raw content is saved for grep/window follow-ups.
async function search(term, { type = "REST", max = 5, lines = 6 } = {}) {
  const { content } = await post("https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown",
    { search_term: term, document_type: type, maximum_results: max, lines_in_each_result: lines });
  const hits = content.split(/\n---\n+(?=#### )/).map(b => ({
    method:   (b.match(/^# Method: (.+)$/m) || [])[1],
    endpoint: (b.match(/^# Method API Endpoint: (.+)$/m) || [])[1],   // callable
    docsUrl:  (b.match(/#### \[[^\]]+\]\((https:[^)]+)\)/) || [])[1],
    gist: ((b.match(/## Method Description:\s*\n([\s\S]{0,400})/) || [])[1] || "")
      .trim().replace(/\s+/g, " ").slice(0, 220),
  })).filter(h => h.docsUrl);
  const saved = save("search.md", content);
  return clip({ ...saved, hits });
}

// ── read a page (docs pages and recipes alike) ────────────────────────────────

// Fetch + save + map in one round: whole text inline when small, else
// { path, bytes, lines, outline } — the outline's line numbers feed grep/window/fields.
async function page(url) {
  const { path: p, lines } = await resolveRef(url);
  const text = lines.join("\n");
  if (text.length <= BUDGET) return text;
  return { path: p, bytes: Buffer.byteLength(text), lines: lines.length, ...outlineOf(lines),
           next: "wx.grep(path, /term/) · wx.window(path, a, b) · wx.fields(path, a, b) — or shell grep -n / sed -n" };
}

// grep -n over a saved file: headers always match, plus your term — numbered for window().
async function grep(ref, pattern) {
  const { path: p, lines } = await resolveRef(ref);
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
  const hits = [];
  lines.forEach((t, i) => { if (/^#{1,3} /.test(t) || re.test(t)) hits.push({ line: i + 1, text: t.trim().slice(0, 100) }); });
  return { file: p, lines: lines.length, shown: Math.min(hits.length, 40),
           omitted: Math.max(0, hits.length - 40), hits: hits.slice(0, 40) };
}

// sed -n 'from,top' over a saved file — quote a section verbatim by grep's line numbers.
async function window(ref, from, to) {
  const { path: p, lines } = await resolveRef(ref);
  return clip({ file: p, text: lines.slice(from - 1, to).map((t, i) => (from + i) + ": " + t.slice(0, 110)).join("\n") });
}

// A big section is usually ONE fenced example — reduce it to its field vocabulary
// instead of paging it; window() only where exact values matter.
async function fields(ref, from, to) {
  const { path: p, lines } = await resolveRef(ref);
  const sec = lines.slice(from - 1, to).join("\n");
  const names = [...new Set(sec.match(/"([a-zA-Z][a-zA-Z0-9]*)":/g) || [])].map(s => s.slice(1, -2));
  return clip({ file: p, sectionLines: to - from + 1, fields: names });
}

// ── the spec index ────────────────────────────────────────────────────────────

// Run a query over the API spec index. In scope: lightIndex (RESOURCES with
// .methods — operationId, summary, httpMethod, path [PARTIAL — never call it],
// publicUrl [callable], docsUrl) and getResourceSchemaByUrl(docsUrl). Arrive with
// a docsUrl and match by it — also the only proof an API does NOT exist.
// A big result is saved as JSON; grep it for the keys you saw in its head.
async function spec(code) {
  if (!/^\s*async function/.test(code)) code = `async function(){ ${code} }`;
  const { result } = await post("https://mcp.wix.com/api/code-mode/search", { code });
  const text = JSON.stringify(result, null, 1);
  if (text.length <= BUDGET) return result;
  return { ...save("spec.json", text),
           shape: Array.isArray(result) ? `Array(${result.length})` : Object.keys(result || {}).slice(0, 15),
           head: text.slice(0, 600) };
}

// ── management recipes ────────────────────────────────────────────────────────

// ~100 curated multi-step admin flows. No arg → categories with counts; a category
// name → its recipes; any other term → search every recipe's name + gist for it.
// Read the chosen url with page(url), then grep/window/fields.
async function recipes(q) {
  const { base, files } = await (await fetch("https://dev.wix.com/docs/skills/manage.manifest.json")).json();
  const cat = f => (f.path.match(/^references\/([^/]+)\//) || [])[1];
  const row = f => ({ name: f.name, cat: cat(f), gist: (f.description || "").slice(0, 120),
                      url: base + f.path, kb: Math.round(f.size / 1024) });
  if (!q) {
    const cats = {};
    for (const f of files) { const c = cat(f); if (c) cats[c] = (cats[c] || 0) + 1; }
    return cats;
  }
  const inCat = files.filter(f => cat(f) === q);
  if (inCat.length) return clip(inCat.map(row));
  const re = new RegExp(q, "i");
  return clip(files.filter(f => re.test(f.name + " " + (f.description || ""))).map(row));
}

module.exports = { post, clip, context, browse, search, page, grep, window, fields, spec, recipes };
