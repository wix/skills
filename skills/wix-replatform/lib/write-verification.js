'use strict';
const { isDeepStrictEqual } = require('node:util');
const crypto = require('node:crypto');
const { contactId, opaqueId } = require('./entity-verification');
const { normalizedDescriptionText } = require('../resources/rp-target-wix/lib/wix-build.js');
const email = value => typeof value === 'string' ? value.trim().toLowerCase() : value;
// Mirrors the same named+numeric HTML-entity decode every source adapter already needs for its
// own "plain text fields are HTML-entity-encoded but never DOM-parsed" trap (e.g.
// rp-import-codegen's product-transform.js decodeEntities): a source HTML body commonly carries
// numeric/hex entities (LIVE-VERIFIED: WooCommerce ships an en dash as `&#8211;`) that Wix's own
// server-side HTML->Ricos conversion decodes into the real character on read-back. Comparing
// visible text without first decoding the SENT side's entities the same way would see every such
// entity as a permanent mismatch, which is exactly the false failure this comparator exists to
// avoid. Kept local (not required from a project's transform code) because write-verification.js
// must not depend on any per-project generated file.
// Live-diagnosed gap (2026-09-28): a 6-entry map covered only the XML-reserved five plus nbsp.
// WordPress's own `wptexturize` (which runs on every post/product description by default)
// rewrites plain typography into exactly these named entities -- straight quotes into curly
// ones, `--`/`---` into en/em dashes, `...` into an ellipsis -- so real WooCommerce/WordPress
// content routinely contains `&mdash;`, `&hellip;`, `&rsquo;`, `&copy;`, and similar even when the
// author never typed a literal entity. Any of these left undecoded on the "expected" (sent) side
// while Wix's Ricos round-trip decodes them on the "actual" (read-back) side produced exactly the
// false verification mismatch this comparator was built to eliminate, just for a different name
// than the numeric-entity case it already handled. Extended to the common WordPress/WooCommerce
// typographic and symbol set, not just the XML-reserved five -- still a static table, not the
// full HTML5 named-character-reference list, because this file has no external dependency and a
// generated description is human-authored prose, not arbitrary markup.
const NAMED_HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  // wptexturize's own typographic substitutions
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  sbquo: '‚', bdquo: '„', laquo: '«', raquo: '»',
  // Common symbols that show up in product/blog copy
  copy: '©', reg: '®', trade: '™', deg: '°',
  plusmn: '±', times: '×', divide: '÷', middot: '·',
  sect: '§', para: '¶', bull: '•', dagger: '†',
  Dagger: '‡', permil: '‰', prime: '′', Prime: '″',
  euro: '€', pound: '£', yen: '¥', cent: '¢', curren: '¤',
  // BUG FIX: still no Latin-1 accented-letter entities -- common in
  // WooCommerce/WordPress content authored or copy-pasted via older tools/CMSes. The full HTML4
  // Latin-1-Supplement letter block, both cases (both are real, distinct named references).
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  eth: 'ð', ntilde: 'ñ',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', thorn: 'þ', yuml: 'ÿ', szlig: 'ß',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç',
  Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë',
  Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï',
  ETH: 'Ð', Ntilde: 'Ñ',
  Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø',
  Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü',
  Yacute: 'Ý', THORN: 'Þ',
};
function decodeHtmlEntities(value) {
  // BUG FIX: the numeric-hex branch's prefix was a literal lowercase `x`
  // (`#x?`), with no `i` flag on the regex -- so an uppercase `&#X2014;` matched neither
  // alternative (the hex-prefix alternative requires the literal "x", and "X" is not itself a
  // valid hex digit once the optional "x" fails to consume it) and was left completely
  // undecoded, even though the handler below already anticipates `entity[1] === 'X'`. Widened to
  // `#[xX]?` so both cases of the hex prefix match; the named-entity branch (`[a-zA-Z]+`) is
  // deliberately left case-sensitive, since HTML named references are themselves case-sensitive
  // (`&amp;` is a valid reference, `&AMP;` is not) and NAMED_HTML_ENTITIES is keyed accordingly.
  return String(value == null ? '' : value).replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_HTML_ENTITIES, entity) ? NAMED_HTML_ENTITIES[entity] : match;
  });
}
// BUG FIX: this used to strip ALL whitespace (`.replace(/\s+/g, '')`)
// on top of normalizedDescriptionText's own collapse-to-single-space -- which destroys the very
// word boundaries a re-serialization difference needs to be judged against. "Fresh Roasted Coffee
// Beans" (correct) and "FreshRoasted CoffeeBeans" (a genuine lost word boundary) both collapsed to
// the identical "FreshRoastedCoffeeBeans" once every space vanished, so a real word-merge/split
// corruption verified as a pass. normalizedDescriptionText already collapses every run of
// whitespace (including tag-boundary spaces introduced by stripping markup) to exactly one space
// and trims the ends -- since decodeHtmlEntities+normalizedDescriptionText run identically on both
// the sent and read-back sides, that single-space normalization is already symmetric and already
// tolerates markup/entity re-serialization; no further whitespace removal is needed or safe.
// Inline elements do not separate words when rendered ("<span>Brand</span><span>Acme</span>"
// displays "BrandAcme", and Stores V3 reads it back that way, LIVE-VERIFIED 2026-10-15), so they
// are removed without a space; every other tag still separates words.
const INLINE_TAG = /<\/?(?:a|abbr|b|bdi|bdo|cite|code|data|dfn|em|font|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var)\b[^>]*>/gi;
const visibleDescriptionText = html => normalizedDescriptionText(decodeHtmlEntities(String(html == null ? '' : html).replace(INLINE_TAG, '')));
// LIVE-VERIFIED (2026-10-15): the stored Ricos description keeps every <br> as
// a "\n" text node, but the plainDescription read-back serializes a <br> run either as one
// space ("here<br />and" -> "here and", 2026-09-27) or as nothing, trimming the whitespace beside
// it ("Tools! <br><br>Next" -> "Tools!Next"). At a <br> position, accept exactly those two
// outcomes; every other character and every other whitespace must still match.
const BREAK_MARK = '\uE000';
const BREAK_RUN = /(?:\s|&nbsp;)*(?:<br\b[^>]*>(?:\s|&nbsp;)*)+/gi;
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function descriptionTextMatches(expectedHtml, actualHtml) {
  const wantsText = visibleDescriptionText(expectedHtml);
  const actualText = visibleDescriptionText(actualHtml);
  if (wantsText === '') return false;
  if (wantsText === actualText) return true;
  const segments = visibleDescriptionText(String(expectedHtml).replace(BREAK_RUN, ` ${BREAK_MARK} `)).split(new RegExp(`\\s*${BREAK_MARK}\\s*`));
  if (segments.length < 2) return false;
  return new RegExp(`^${segments.map(escapeRegExp).join(' ?')}$`).test(actualText);
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

// Expected fields come from the source projection. Extra server fields do not satisfy
// missing fields, and null/empty/false/zero remain distinct. No heuristic normalization.
function assertProjection(value, path = 'expected') {
  if (value === undefined) throw new Error(`Undefined verification value at ${path}; omit the key or supply an explicit JSON value`);
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) assertProjection(value[i], `${path}[${i}]`);
    else for (const [key, child] of Object.entries(value)) assertProjection(child, `${path}.${key}`);
  }
}
function compareProjection(expected, actual, { kind = '', path = '' } = {}) {
  assertProjection(expected);
  const checks = [];
  function compare(e, a, p, present) {
    if (kind === 'contact' && p === 'email.email') {
      checks.push({ path: p, matches: present && email(e) === email(a) });
    } else if (p === 'plainDescription' && typeof e === 'string') {
      // LIVE-VERIFIED (2026-09-27): Stores V3's Get Product does not
      // echo plainDescription -- it converts the HTML to a Ricos document server-side and reads
      // back a RE-SERIALIZATION of that document, not the sent bytes (e.g. a source <strong>
      // becomes <span style="font-weight: 700">, and HTML entities get decoded). That is Wix's
      // own conversion, unavoidable and benign, so this leaf compares VISIBLE TEXT -- the same
      // extractor wix-build.js's composeProductDescription uses to decide whether a description
      // is real content -- never markup. A genuinely different or lost description still fails:
      // this tolerates re-serialization, not a text change, and never passes on empty text.
      checks.push({ path: p, matches: present && typeof a === 'string' && descriptionTextMatches(e, a) });
    } else if (/(^|\.)amount$/.test(p) && typeof e === 'string' && /^-?\d+(\.\d+)?$/.test(e.trim())) {
      // LIVE-VERIFIED (2026-10-15): Stores V3 normalizes decimal strings on
      // read-back -- a sent price "65.00" comes back "65", "21.20" comes back "21.2". The money
      // value is identical, so an amount leaf compares numerically; a different amount (or a
      // missing / non-numeric one) still fails.
      checks.push({ path: p, matches: present && typeof a === 'string' && /^-?\d+(\.\d+)?$/.test(a.trim()) && Number(e) === Number(a) });
    } else if (Array.isArray(e) && /(^|\.)media\.itemsInfo\.items$/.test(p)) {
      // LIVE-VERIFIED (2026-09-27): every product image is rehosted
      // to Wix's own CDN (static.wixstatic.com) under a server-minted id/url the instant it
      // ingests -- expected, unavoidable platform behavior, not data loss. The url this
      // comparator sent will therefore never appear in the read-back, so identity here is never
      // the url (or a filename derived from it): it is the item COUNT, plus -- for whichever
      // items the writer's own record shows we asked to carry alt text -- that altText survives
      // the rehost verbatim (LIVE-VERIFIED: Wix echoes it back exactly, both on the item itself
      // and nested under item.image). A missing/extra image, or a changed altText, still fails.
      //
      // KNOWN LIMITATION: this cannot detect two
      // images swapped between slots, or an entirely wrong image landing in a slot, when neither
      // altText nor displayName was set on the sent side -- common for sources with no alt text.
      // `buildMedia` (wix-build.js) sends only `{url, altText, displayName}` per item; the sent
      // `url` is the ONLY other candidate per-item identity and it is exactly the field this
      // comment already establishes never survives the rehost, so nothing else is available to
      // compare here without new information from Wix's API. This check also assumes rehosted
      // items keep the SENT order (`a[i]` correlates to `e[i]` throughout this block) -- that
      // assumption is undocumented and has not been independently live-verified either; if Wix's
      // rehost does not preserve order, the existing altText/displayName checks below could
      // already be comparing against the wrong item, not just this count check.
      checks.push({ path: p, matches: Array.isArray(a) && e.length === a.length });
      e.forEach((item, i) => {
        const child = Array.isArray(a) ? a[i] : undefined;
        const alt = item && typeof item === 'object' ? item.altText : undefined;
        if (typeof alt === 'string' && alt.trim() !== '') {
          // `??` only falls through on null/undefined -- an actual side that carries altText as
          // an EMPTY STRING (the rehost keeping the field but losing its value) must still count
          // as "did not survive", the same as a missing field entirely. `||` falls through on any
          // falsy value, which is what "only check the field when non-empty" means everywhere else
          // in this comparator (see isBlank-style checks in wix-build.js).
          const actualAlt = child?.altText || child?.image?.altText;
          checks.push({ path: `${p}[${i}].altText`, matches: Boolean(child) && actualAlt === alt });
        }
        // wix-build.js's buildMedia writes displayName on every media item it constructs whenever
        // the source record has one (domains/stores/entities/product.json: displayName "must not
        // be flattened away"). Only check it when the writer's own record shows we asked to carry
        // it -- the same "only check what we actually asked for" pattern altText uses above -- so
        // a product with no displayName at all is never penalized for it being absent.
        const displayName = item && typeof item === 'object' ? item.displayName : undefined;
        if (typeof displayName === 'string' && displayName.trim() !== '') {
          const actualDisplayName = child?.displayName || child?.image?.displayName;
          checks.push({ path: `${p}[${i}].displayName`, matches: Boolean(child) && actualDisplayName === displayName });
        }
      });
    } else if (Array.isArray(e)) {
      checks.push({ path: p, matches: Array.isArray(a) && e.length === a.length });
      e.forEach((v, i) => compare(v, a?.[i], `${p}[${i}]`, Array.isArray(a) && i < a.length));
    } else if (e && typeof e === 'object') {
      if (!Object.keys(e).length) checks.push({ path: p, matches: present && isDeepStrictEqual(e, a) });
      else for (const [k, v] of Object.entries(e)) compare(v, a?.[k], p ? `${p}.${k}` : k, own(a, k));
    } else checks.push({ path: p, matches: present && isDeepStrictEqual(e, a) });
  }
  compare(expected, actual, path, actual !== undefined);
  return { verified: checks.length > 0 && checks.every(c => c.matches), checks };
}
function contactIdentity(expected, actual, id) {
  const checks = [{ path: 'id', matches: contactId(id) && actual?.id === id && !actual?._dryRunPlaceholder }];
  const hasExternal = typeof expected?.externalId === 'string' && expected.externalId.trim() !== '';
  const hasEmail = typeof expected?.email?.email === 'string' && email(expected.email.email) !== '';
  checks.push({ path: 'source-identity', matches: hasExternal || hasEmail });
  if (hasExternal) checks.push({ path: 'externalId', matches: actual?.externalId === expected.externalId });
  if (hasEmail) checks.push({ path: 'email.email', matches: email(actual?.email?.email) === email(expected.email.email) });
  return { verified: checks.every(c => c.matches), checks };
}
function verifyContact(expected, actual, id) {
  const identity = contactIdentity(expected, actual, id);
  const values = compareProjection(expected, actual, { kind: 'contact' });
  return { verified: identity.verified && values.verified, checks: [...identity.checks, ...values.checks] };
}
function subscriptionExpected(product) {
  const value = product?.subscriptionDetails;
  const entries = value?.subscriptions;
  if (!Array.isArray(entries) || !entries.length || entries.some(s => !s?.title) || new Set(entries.map(s => s.title)).size !== entries.length) {
    throw new Error('Subscription verification requires nonempty, uniquely titled subscriptions');
  }
  if (typeof value.allowOneTimePurchases !== 'boolean' || entries.some(s =>
    !['title', 'description', 'frequency', 'interval', 'autoRenewal'].every(k => own(s, k)))) {
    throw new Error('Subscription verification requires the complete expected field projection');
  }
  return JSON.parse(JSON.stringify(value));
}
function verifySubscriptionEvidence(evidence) {
  try {
    if (!evidence || evidence.dryRun || !opaqueId(evidence.targetId)) throw new Error('Invalid evidence');
    const expected = subscriptionExpected({ subscriptionDetails: evidence.expected });
    const actual = evidence.actual;
    const entries = actual?.subscriptionDetails?.subscriptions;
    const checks = [{ path: 'product.id', matches: actual?.id === evidence.targetId && !actual?._dryRunPlaceholder },
      { path: 'subscriptionDetails.subscriptions.length', matches: Array.isArray(entries) && entries.length === expected.subscriptions.length },
      { path: 'subscriptionDetails.allowOneTimePurchases', matches: actual?.subscriptionDetails?.allowOneTimePurchases === expected.allowOneTimePurchases }];
    for (const wanted of expected.subscriptions) {
      const matches = (entries || []).filter(s => s?.title === wanted.title);
      const entry = matches.length === 1 ? matches[0] : undefined;
      checks.push({ path: `subscriptions:${wanted.title}.id`, matches: matches.length === 1 && opaqueId(entry?.id) });
      checks.push(...compareProjection(wanted, entry, { path: `subscriptions:${wanted.title}` }).checks);
    }
    return { verified: checks.every(c => c.matches), checks };
  } catch { return { verified: false, checks: [{ path: 'evidence', matches: false }] }; }
}
function verifyProduct(expected, actual, id, { marker, variants = [] } = {}) {
  const checks = [{ path: 'id', matches: opaqueId(id) && actual?.id === id && !actual?._dryRunPlaceholder }];
  // Marker must have been selected from the source, not filled from the returned entity.
  checks.push({ path: 'source-marker', matches: Boolean(marker?.path) && marker.value !== undefined && marker.value !== '' });
  if (marker?.path) {
    const value = marker.path.split('.').reduce((v, k) => v?.[k], actual);
    checks.push({ path: marker.path, matches: isDeepStrictEqual(marker.value, value) });
  }
  checks.push(...compareProjection(expected, actual).checks);
  const targetVariants = actual?.variantsInfo?.variants;
  const seen = new Set();
  for (const v of variants) {
    const matches = (targetVariants || []).filter(t => t?.id === v.variantId);
    checks.push({ path: `variant:${v.variantId}`, matches: opaqueId(v.variantId) && !seen.has(v.variantId) && matches.length === 1 });
    seen.add(v.variantId);
    checks.push(...compareProjection(v.expected, matches[0]).checks);
  }
  return { verified: checks.every(c => c.matches), checks };
}
const CONTRACT_DIGEST = digest({ version: 1, contact: 'source-key/externalId+email/exact-values', product: 'source-marker/variant-id/exact-values' });
function receipt({ siteId, sourceKey, kind, expected, targetId, actual, marker, variants, operation, attempts = 1, dryRun = false }) {
  const comparison = kind === 'contact' ? verifyContact(expected, actual, targetId) : verifyProduct(expected, actual, targetId, { marker, variants });
  return { schemaVersion: 1, siteId, sourceKey, kind, targetId, expected, actual, marker, variants, operation, attempts, dryRun,
    payloadDigest: digest({ expected, marker, variants }), contractDigest: CONTRACT_DIGEST,
    ...comparison, verified: !dryRun && Boolean(siteId && sourceKey && operation) && comparison.verified };
}
function validReceipt(r, context = {}) {
  if (!r || r.schemaVersion !== 1 || !['contact', 'product'].includes(r.kind) || !r.verified || r.dryRun || r.contractDigest !== CONTRACT_DIGEST) return false;
  if (!r.expected || r.payloadDigest !== digest({ expected: r.expected, marker: r.marker, variants: r.variants })) return false;
  for (const key of ['siteId', 'sourceKey', 'targetId', 'payloadDigest', 'kind']) if (context[key] !== undefined && r[key] !== context[key]) return false;
  try { return receipt(r).verified; } catch { return false; }
}
module.exports = { assertProjection, email, digest, compareProjection, contactIdentity, verifyContact, subscriptionExpected,
  verifySubscriptionEvidence, verifyProduct, receipt, validReceipt, CONTRACT_DIGEST };
