// Wix docs helpers for the Base44 sandbox — the zero-disk set, matching the
// "Building on Wix from Base44" guide: every helper is fetch → reduce in memory →
// return ≤ 4,000 chars (exec results clip at ~5,000). Nothing touches disk; state
// between rounds = re-fetching (~1s). Oversized returns come back as
// { truncated, total, head } — narrow and re-run.
//
// Load per exec (execs share no state) — needs only global fetch, no require:
//   const src = await (await fetch("https://www.wix.com/skills/wix-docs-base44/scripts/lite.js")).text();
//   const wx = (() => { const m = { exports: {} };
//     new Function("module", "exports", src)(m, m.exports); return m.exports; })();
//
//   return await wx.browse("https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings",
//                          { filter: "resched", include: ["METHOD"], depth: 4 });
//
// If a response shape surprises you, read this file and hand-roll the call — the
// functions are thin. Never guess an API from memory.

const BUDGET = 4000;

// Cap any return; { truncated } means narrow the query, not page the blob.
function clip(out) {
  const s = typeof out === "string" ? out : JSON.stringify(out);
  return s.length <= BUDGET ? out : { truncated: true, total: s.length, head: s.slice(0, BUDGET) };
}

// One transport for every JSON call — Content-Type, optional Bearer, ok-guard.
// Admin calls are this with the connector token: post(publicUrl, body, accessToken).
async function post(url, body, token) {
  const r = await fetch(url, { method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) } });
  if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 300));
  return r.json();
}

// ── gather context ────────────────────────────────────────────────────────────

// The dynamic context report. No section → the whole report when it fits, else its
// header outline; with one → that section's text. `markdown: ""` = bad token, never
// an empty site.
async function context(token, section) {
  const { markdown } = await post(
    "https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown", {}, token);
  if (!section) {
    if (markdown.length <= BUDGET) return markdown;   // most sites: the whole report, one round
    return { truncated: true, total: markdown.length, head: markdown.slice(0, BUDGET),
             note: "site data — never saved; narrow: wx.context(token, '<section name>')" };
  }
  const m = markdown.match(new RegExp("^#{1,3} .*" + section + "[\\s\\S]*?(?=\\n#{1,3} |$)", "im"));
  return clip({ total: markdown.length, section: m ? m[0] : "not found — call context(token) for the outline" });
}

// ── find what to read ─────────────────────────────────────────────────────────

// Browse the docs tree — deterministic. menuUrl alone orients (children + counts);
// filter before listing methods, unfiltered listings clip.
async function browse(menuUrl, { include, filter, depth } = {}) {
  const { content } = await post("https://www.wixapis.com/mcp-docs-search/v1/docs/menu/browse", {
    menu_url: menuUrl, ...(include && { include }),
    ...(filter && { name_filter: filter }), ...(depth && { depth }),
  });   // 404 "No menu node found" ⇒ re-orient a level up
  return clip(content);
}

// Semantic search — ranks, never says "no match". Each hit reduced to the riches;
// hits often ARE the answer. type: REST | SDK | WIX_HEADLESS | VELO | CLI.
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
  return clip({ total: content.length, hits });
}

// ── read a doc page ───────────────────────────────────────────────────────────

// Map a page (docs pages AND recipes): headers always, plus lines matching `term`.
// No term = the outline; header-to-header = window bounds. omitted > 0 ⇒ narrow.
async function page(url, term) {
  const res = await fetch(url.replace(/\.md$/, "") + ".md");
  if (!res.ok) return { status: res.status, hint: "not a docs page — take URLs from output, don't compose" };
  const all = (await res.text()).split("\n");
  const re = term && new RegExp(term, "i");
  const hits = [];
  all.forEach((text, i) => {
    if (/^#{1,3} /.test(text) || (re && re.test(text)))
      hits.push({ line: i + 1, text: text.trim().slice(0, 100) });
  });
  return { lines: all.length, shown: Math.min(hits.length, 40),
           omitted: Math.max(0, hits.length - 40), hits: hits.slice(0, 40) };
}

// Quote a section verbatim by the map's line numbers (REST examples live under
// ### Examples below ## REST API — usually all you need).
async function window(url, from, to) {
  const all = (await (await fetch(url.replace(/\.md$/, "") + ".md")).text()).split("\n");
  return clip(all.slice(from - 1, to).map((t, i) => (from + i) + ": " + t.slice(0, 110)).join("\n"));
}

// A big section is usually ONE fenced example — reduce it to its field vocabulary
// instead of paging it; window() only where exact values matter.
async function fields(url, from, to) {
  const all = (await (await fetch(url.replace(/\.md$/, "") + ".md")).text()).split("\n");
  const sec = all.slice(from - 1, to).join("\n");
  const names = [...new Set(sec.match(/"([a-zA-Z][a-zA-Z0-9]*)":/g) || [])].map(s => s.slice(1, -2));
  return clip({ sectionLines: to - from + 1, fields: names });
}

// ── the spec index ────────────────────────────────────────────────────────────

// Run a query over the API spec index. In scope: lightIndex (RESOURCES with
// .methods — operationId, summary, httpMethod, path [PARTIAL — never call it],
// publicUrl [callable], docsUrl) and getResourceSchemaByUrl(docsUrl). Arrive with
// a docsUrl and match by it — also the only proof an API does NOT exist.
async function spec(code) {
  if (!/^\s*async function/.test(code)) code = `async function(){ ${code} }`;
  const { result } = await post("https://mcp.wix.com/api/code-mode/search", { code });
  return clip(result);
}

// ── management recipes ────────────────────────────────────────────────────────

// ~100 curated multi-step admin flows. No arg → categories with counts; a category
// name → its recipes; any other term → search every recipe's name + gist for it
// (names and gists are written for choosing).
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

// Read a chosen recipe — whole when small, outline first when big; then quote or
// reduce sections by the outline's line numbers with window(url, a, b) /
// fields(url, a, b). A matching recipe beats composing the flow from single
// endpoints: it carries ordering and cross-step gotchas no method page mentions.
async function recipe(url) {
  const text = await (await fetch(url)).text();
  if (text.length <= BUDGET) return text;
  const outline = text.split("\n").map((t, i) => /^#{1,3} /.test(t)
    ? { line: i + 1, text: t.slice(0, 80) } : null).filter(Boolean);
  return clip({ total: text.length, outline });
}

module.exports = { post, clip, context, browse, search, page, window, fields, spec, recipes, recipe };
