#!/usr/bin/env node
// Serve a mirror made by mirror-site.mjs, offline.
//
//   node scripts/copy/serve-mirror.mjs <outDir> [--port 8732] [--volatile name,name]
//
// Use a port of your own per site: 8732 may already be served by another agent's mirror, and
// a failed listen (EADDRINUSE) leaves that other server answering. GET /__mirror-site returns
// the host this server mirrors.
//
// Dynamic pages: a head shim maps hosts that page scripts build at runtime, a request that
// misses by exact URL falls back to path + stable query params (timestamps, visitor ids and the
// JSONP callback are ignored, the callback is renamed in the answer), and a rewritten local URL
// echoed back inside a query value is mapped back to the recorded one.
//
// The source site's own URLs map to the server root (https://site/?page_id=5 -> /?page_id=5);
// every other host maps to /_/<host>/... . URLs inside HTML, CSS, JS, JSON and SVG are
// rewritten to those local paths as they are served, so the browser never leaves the
// server. Third-party iframes saved as snapshots (index.embeds) are replaced by an <img> of the
// same size and style, marked data-embed-src (snapshots are the iframe's content box; iframes sit
// on the baseline, where themes often set img { vertical-align: bottom }). Requests the mirror does not hold get a 404 and are logged to <outDir>/misses.log.
import http from 'http';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const outDir = args[0];
const port = Number(opt('port', 8732));
const index = JSON.parse(fs.readFileSync(`${outDir}/index.json`, 'utf8'));
const site = index.site;
const hosts = [...new Set(Object.keys(index.resources).map((u) => new URL(u).host))].sort((a, b) => b.length - a.length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// https://host, http://host, //host, and the JSON-escaped https:\/\/host forms
const hostRe = new RegExp(`(?:https?:)?(\\\\?/)\\1(${hosts.map(esc).join('|')})(?![\\w.-])`, 'g');
const embeds = index.embeds || {};
const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&#038;/g, '&');
const swapEmbeds = (html) => html.replace(/<iframe\b([^>]*)\bsrc="([^"]+)"([^>]*)>\s*<\/iframe>/gi, (all, a, src, b) => {
  const e = embeds[unescape(src)];
  if (!e) return all;
  let attrs = `${a} ${b}`.replace(/\b(frameborder|scrolling|marginheight|marginwidth|allowfullscreen|allow|loading)(="[^"]*")?/gi, '');
  const style = (attrs.match(/\bstyle="([^"]*)"/i) || [, ''])[1];
  attrs = attrs.replace(/\bstyle="[^"]*"/i, '');
  return `<img${attrs} src="/__embed/${e.body}" data-embed-src="${src}" alt="embedded content (snapshot)" style="${style};vertical-align:baseline">`;
});
const textual = (t) => /text\/|javascript|json|xml|svg/.test(t);

// Volatile query params (timestamps, visitor ids, JSONP callback names) never repeat between
// loads, so an exact URL match cannot hit on replay. Fall back to path + stable params.
// Only names that are per-load by convention; generic ones (t, url, title, vid) can be real keys,
// so a site that varies by one of them adds it with --volatile name,name.
const VOLATILE = new RegExp('^(_|json|currentLocation|currentUrl|referrer|cb|cookieId|userId|emailId|callback|dwac|visitorId|rnd' + opt('volatile', '').split(',').filter(Boolean).map((n) => '|' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + ')$', 'i');
const normKey = (u) => { try { const x = new URL(u); const q = [...x.searchParams].filter(([k]) => !VOLATILE.test(k)).map(([k, v]) => k + '=' + v).sort().join('&'); return x.origin + x.pathname + '?' + q; } catch { return u; } };
const fuzzy = new Map();
for (const [u, r] of Object.entries(index.resources)) if (r.body && u.includes('?') && !fuzzy.has(normKey(u))) fuzzy.set(normKey(u), [u, r]);
function lookup(original) {
  for (let hop = 0; hop < 5; hop++) {
    const r = index.resources[original] || index.resources[original.replace(/^https:/, 'http:')] || index.resources[original.replace(/^http:/, 'https:')];
    if (!r) { const f = fuzzy.get(normKey(original)); return f ? { ...f[1], recordedUrl: f[0] } : null; }
    if (r.location !== undefined && r.status >= 300) { original = new URL(r.location, original).href; continue; }
    return r;
  }
  return null;
}

// Page scripts assemble URLs at runtime (script.src = host + path), which the static rewrite
// below never sees. This shim, injected first in <head>, maps any mirrored host to /_/<host>/.
const injectShim = (html, origin) => {
  const shim = '<script>(function(){var O=location.origin,S=' + JSON.stringify(site) + ',H=' + JSON.stringify(hosts) + ';function m(u){try{var x=new URL(u,location.href);if(x.origin===O)return u;if(x.host===S)return O+x.pathname+x.search+x.hash;if(H.indexOf(x.host)>-1)return O+"/_/"+x.host+x.pathname+x.search+x.hash}catch(e){}return u}' +
    'var d=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,"src");Object.defineProperty(HTMLScriptElement.prototype,"src",{get:d.get,set:function(v){d.set.call(this,m(v))},configurable:true});' +
    'var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(n==="src"&&/^(SCRIPT|IMG|IFRAME|LINK)$/.test(this.tagName))v=m(v);return sa.call(this,n,v)};' +
    'var f=window.fetch;window.fetch=function(u,o){return f.call(this,typeof u==="string"?m(u):u,o)};var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(a,u){arguments[1]=m(u);return xo.apply(this,arguments)}})()</script>';
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => h + shim) : shim + html;
};
http.createServer((req, res) => {
  // identity probe: check-mirror asks which site a port serves, so a stale server for another site is caught
  if (req.url === '/__mirror-site') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(site); }
  const em = req.url.match(/^\/__embed\/([0-9a-f]{40})$/);
  if (em) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(fs.readFileSync(`${outDir}/bodies/${em[1]}`)); }
  const m = req.url.match(/^\/_\/([^/]+)(\/.*)?$/);
  const original = m ? `https://${m[1]}${m[2] || '/'}` : `https://${site}${req.url}`;
  // a page that echoes a rewritten URL back (inside a query value) must still match what was recorded
  const unlocal = (u) => { const o = `http://${req.headers.host}`; const e = encodeURIComponent(o); const swap = (from, to) => u = u.split(from).join(to);
    for (const h of hosts) { swap(`${o}/_/${h}`, `https://${h}`); swap(`${e}%2F_%2F${encodeURIComponent(h)}`, encodeURIComponent(`https://${h}`)); }
    swap(o, `https://${site}`); swap(e, encodeURIComponent(`https://${site}`)); return u; };
  const r = lookup(original) || lookup(unlocal(original));
  if (!r || !r.body) { fs.appendFileSync(`${outDir}/misses.log`, `${original}\n`); res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(`${outDir}/bodies/${r.body}`);
  if (textual(r.type)) {
    const origin = `http://${req.headers.host}`;
    body = body.toString('utf8');
    if (r.recordedUrl) { // JSONP: answer with the callback name this load asked for
      const was = new URL(r.recordedUrl).searchParams.get('callback'), want = new URL(original).searchParams.get('callback');
      if (was && want && was !== want) body = body.split(was).join(want);
    }
    if (/html/.test(r.type)) body = injectShim(swapEmbeds(body), origin); // swapEmbeds runs before the URL rewrite, so the src still matches; the shim is added last of the HTML edits
    body = body.replace(hostRe, (all, slash, host) => {
      const base = host === site ? origin : `${origin}/_/${host}`;
      return slash === '\\/' ? base.replace(/\//g, '\\/') : base;
    });
  }
  res.writeHead(r.status || 200, { 'content-type': r.type || 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(body);
}).listen(port, '127.0.0.1', () => console.log(`mirror of ${site} at http://127.0.0.1:${port}/ (${Object.keys(index.resources).length} resources)`));
