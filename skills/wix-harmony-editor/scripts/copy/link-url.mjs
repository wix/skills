// URL helpers shared by build-description and its tests.
//
// normU: the key a link is looked up by in a --linkmap. Only parts that are equivalent by the URL
// rules are normalised: scheme and host are case-insensitive (lowercased), a fragment never reaches
// the server (dropped), a trailing slash on the path and percent-encoding of the path (decoded, so a
// Hebrew slug compares equal to its encoded form) are folded, and per-visit tracking parameters are
// removed. The path and the query VALUES keep their case: /Product/A and /product/a can be two
// different pages, and the two are different keys.
export const TRACKING = /^(utm_|visitorid$|fbclid$|gclid$|_ga$|mc_)/i;

export const stripTracking = (u) => {
  try { const x = new URL(u); let changed = false; for (const k of [...x.searchParams.keys()]) if (TRACKING.test(k)) { x.searchParams.delete(k); changed = true; } return changed ? x.href : u; } catch { return u; }
};

const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

export const normU = (u) => {
  const s = String(u);
  try {
    const x = new URL(stripTracking(s.replace(/#.*$/, '')));
    const path = dec(x.pathname).replace(/\/$/, '');
    const q = [...x.searchParams].map(([k, v]) => `${dec(k)}=${dec(v)}`).join('&');
    return `${x.protocol}//${x.host.toLowerCase()}${path}${q ? '?' + q : ''}`;
  } catch {
    return dec(s.replace(/#.*$/, '')).replace(/\/$/, ''); // not an absolute URL (mailto:, tel:, a relative path): compared as written
  }
};
