// Content hash of a page description, ignoring the check stamp itself. check-description.mjs
// writes it when (and only when) the check passed; deploy-description.mjs recomputes it, so a
// description that failed its check, or was edited after it, is refused.
import crypto from 'crypto';

export const descHash = (desc) => {
  const { checkedAt, checkedHash, ...rest } = desc;
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
};

// Links that still point at the source site: the cutover hand-off.
// Component links marked sourcePage, and inline <a href> inside rich text (those stay inline, so
// they never get a `link`) whose URL is on the source origin (desc.source.url).
export const openItems = (desc) => {
  const urls = new Map();
  const add = (u, k) => { const l = urls.get(u) || urls.set(u, []).get(u); if (!l.includes(k)) l.push(k); };
  let origin = null; try { origin = new URL(desc.source?.url).origin; } catch {}
  for (const c of desc.components || []) {
    if (c.link?.sourcePage) add(c.link.url, c.key);
    if (origin && c.html) for (const m of c.html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) { const u = m[1].replace(/&amp;/g, '&'); if (u === origin || u.startsWith(origin + '/') || u.startsWith(origin + '?')) add(u, c.key); }
  }
  return [...urls].map(([url, keys]) => ({ type: 'links-to-old-site', url, components: keys, action: 'copy that page to Harmony or repoint the link; resolved when no link marked sourcePage remains' }));
};

// Pages the new site does not have yet. A link whose linkmap entry says `unbuilt` points at a stand-in
// page (Home, the cart) so the visitor is never sent to the old site, but the page is still missing:
// it stays here, with the source URL, until the entry stops saying `unbuilt` (the real page is mapped).
// A redirect to an existing page never resolves it. Reasons and components come from the description,
// so the hand-off cannot drift from the links.
export const pendingItems = (desc) => {
  const by = new Map();
  const add = (u, reason, redirectedTo, key) => { const e = by.get(u) || by.set(u, { reason, redirectedTo, keys: [] }).get(u); if (!e.keys.includes(key)) e.keys.push(key); };
  const to = (l) => (l ? (l.pageId ? `page ${l.pageId}${l.innerRoute ? '/' + l.innerRoute : ''}` : l.url || l.type) : 'inline URL');
  for (const c of desc.components || []) {
    if (c.link?.unbuilt) add(c.link.unbuilt.url, c.link.unbuilt.reason, to(c.link), c.key);
    for (const u of c.unbuiltInline || []) add(u.url, u.reason, u.standIn || 'inline URL', c.key);
  }
  return [...by].map(([url, e]) => ({
    type: 'page-not-built', url, reason: e.reason, standInFor: e.redirectedTo, components: e.keys,
    responsibleRole: 'Cutover Operator (page content: site owner)',
    action: 'build this page in Harmony or confirm it is intentionally dropped, then map its source URL to the real page in the linkmap (without `unbuilt`) and re-run build-description',
    resolvedBy: 'the source URL maps to a real page in the linkmap; a link that only points at a stand-in page (Home, cart) does not resolve it',
  }));
};
