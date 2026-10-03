'use strict';

// Invoice discovery for the WordPress source: who issued each document, and where its bytes live.
//
// Invoices are resolved PER RUN, not assumed. A store may have no invoices at all, may hold only
// numbers, may host PDFs on its own filesystem, or may have them sitting on a payment provider's
// or accounting system's server. Those four outcomes want four different actions, and the wrong
// default is expensive in both directions: copying every document duplicates personal data the
// merchant's provider already holds, while skipping them loses documents that die with the source
// site.
//
// Two rules shape the code more than anything else:
//
//   1. SAMPLING DISCOVERS PATTERNS; PATTERNS ARE THEN APPLIED TO EVERYONE. Key names vary per
//      store and per plugin version -- one surveyed store carried `payplus_invoice_numberD`, with
//      a trailing capital. So discovery matches key FAMILIES rather than authored key names, and
//      a pattern found in a sample is then run across the full in-scope order population. A
//      sample-only pass reports a fraction of the documents and calls it complete.
//   2. A DISCOVERED URL IS UNTRUSTED INPUT. It comes from source-site metadata, and something
//      will eventually fetch it. So it is classified before anything touches it: HTTPS only, no
//      embedded credentials, no private or loopback address, port 443 only, bounded redirects,
//      bounded time and size. A hosted-document URL is also a bearer link whose filename can
//      carry the customer's name and the invoice number, so it is never logged and never stored.

const INVOICE_KEY_PATTERNS = [
  { family: 'invoice-number', pattern: /invoice.*number|number.*invoice|invoice_?no\b/i },
  { family: 'invoice-document', pattern: /invoice.*(document|doc|pdf|file|url|link)|(document|pdf)_?invoice/i },
  { family: 'document-address', pattern: /doc(ument)?_?address|address_?doc(ument)?/i },
  { family: 'invoice-type', pattern: /invoice.*type|type.*invoice/i },
];

// Signal A -- rows kept by a WordPress-side invoicing plugin in tables of its OWN -- has nothing
// to query yet, and this module deliberately does not pretend otherwise. The table names that
// used to sit here (`wcpdf_invoice_number` and friends) are META KEY names, not tables: the common
// PDF-invoice plugin stores its numbers in order meta, so it is read through Signal B. A
// recognized-table list will be worth having when a plugin profile establishes a real row-bearing
// table and something composes the row counts into strategy selection; inventing one from
// meta-key-shaped strings only made the gap harder to see.
//
// A caller that discovers an unrecognized invoice-shaped table should report it as a finding.

const {
  isPrivateHostname,
  classifyDocumentUrl,
  redactUrlForLog,
} = require('../../../lib/document-url-guard.js');

const STRATEGIES = {
  NONE_FOUND: 'none-found',
  NUMBER_ONLY: 'number-only',
  WORDPRESS_HOSTED: 'wordpress-hosted',
  THIRD_PARTY_HOSTED: 'third-party-hosted',
  MIXED: 'mixed',
};

function classifyMetaKey(key) {
  if (!key) return null;
  for (const entry of INVOICE_KEY_PATTERNS) {
    if (entry.pattern.test(key)) return entry.family;
  }
  return null;
}

// Discovery over a sample: which key families this store actually uses, and under which concrete
// key names. The names are returned so the population pass can read exactly those keys rather
// than re-matching patterns per order.
function discoverInvoicePatterns(sampleOrders = []) {
  const keysByFamily = new Map();
  for (const order of sampleOrders) {
    for (const key of Object.keys(order.meta || {})) {
      const family = classifyMetaKey(key);
      if (!family) continue;
      const value = order.meta[key];
      if (value === null || value === undefined || String(value).trim() === '') continue;
      if (!keysByFamily.has(family)) keysByFamily.set(family, new Set());
      keysByFamily.get(family).add(key);
    }
  }
  const families = [...keysByFamily.keys()].sort();
  const keys = [...new Set([...keysByFamily.values()].flatMap((set) => [...set]))].sort();
  return {
    families,
    keys,
    sampled: sampleOrders.length,
    // A sample that found nothing is not evidence that the population has nothing; it is a
    // reason to say so in the report rather than to conclude "no invoices".
    conclusive: keys.length > 0,
  };
}

function firstPopulated(meta, keys) {
  for (const key of keys) {
    const value = meta && meta[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text.length > 0) return { key, value: text };
  }
  return null;
}

// Which of several document-family keys actually holds the document.
//
// A store does not carry one document key, it carries a cluster. The surveyed PayPlus store has
// four: `copyDocAddress`, `docUID`, `originalDocAddress`, `plus_docs`. They are not
// interchangeable -- one is a URL to the ORIGINAL tax receipt, one is a URL to a COPY of it, one
// is a bare identifier, and one is a blob. Picking by key-name order picked the copy, because
// "copy" sorts before "original"; alphabetical order was deciding which legal document got
// archived. On an Israeli tax receipt original-versus-copy is not a cosmetic distinction.
//
// So selection looks at the VALUE first: a key whose value is not an http(s) URL cannot be the
// document, however document-shaped its name is. `docUID` is excluded here rather than surviving
// to the URL guard, where it would be rejected as malformed and reported as "no document found"
// while the real URL sat unread in the next key.
//
// Among the keys that do hold URLs, name hints break the tie, and the losers are KEPT rather than
// dropped -- see selectDocument below, where they remain as ordered fallbacks.
//
// The hints match whole words in the key, not substrings anywhere in it. Matching `/copy/` against
// the raw key demoted `copyright_document_url`, and `/original/` promoted
// `invoice_original_preview_url` -- a thumbnail -- above the real receipt. A key is split on
// separators and camelCase humps and the hint has to BE one of the resulting words.
//
// These are heuristics over a naming convention nobody agreed to, so they only ever break ties
// between candidates that are all real URLs; none of them can exclude a candidate.
const DOCUMENT_WORD_RANK = new Map([
  ['original', 0],
  ['copy', 2], ['duplicate', 2],
  // A preview or thumbnail is a picture OF the document, not the document. Ranked below the copy.
  ['preview', 3], ['thumb', 3], ['thumbnail', 3], ['sample', 3],
  // Documents a store attaches to orders that are not the invoice. Word-splitting alone was not
  // enough for these: with no hint firing they landed on the neutral rank and won ties
  // alphabetically, so `invoice_copyright_notice_url` still beat `invoice_document_url`. They are
  // ranked last instead -- still eligible, because a mis-named key is better than no document,
  // but only if nothing else is there.
  ['copyright', 4], ['notice', 4], ['terms', 4], ['policy', 4], ['license', 4], ['licence', 4],
]);
const NEUTRAL_RANK = 1; // Unhinted keys sit between "original" and "copy".

function looksLikeUrl(text) {
  return /^https?:\/\//i.test(text);
}

// `copyDocAddress` -> copy, doc, address. `invoice_original_preview_url` -> invoice, original,
// preview, url. `copyright` -> copyright, which is deliberately NOT the word "copy".
//
// Acronyms need their own boundary. Splitting on lower-to-upper alone left `invoicePDFPreviewURL`
// as one word `pdfpreviewurl`, so "preview" never matched and a thumbnail outranked the document.
// Plugin keys are full of these: PDF, URL, ID, HTML.
function wordsInKey(key) {
  return String(key)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')   // PDFPreview -> PDF Preview
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')      // copyDoc    -> copy Doc
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function rankDocumentKey(key) {
  // The worst hint present wins: a key naming both "original" and "preview" is a preview OF the
  // original, and a preview is not the document.
  const hinted = wordsInKey(key)
    .map((word) => DOCUMENT_WORD_RANK.get(word))
    .filter((rank) => rank !== undefined);
  return hinted.length === 0 ? NEUTRAL_RANK : Math.max(...hinted);
}

function selectDocument(meta, keys) {
  const populated = [];
  for (const key of keys) {
    const value = meta && meta[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text.length === 0) continue;
    populated.push({ key, value: text, url: looksLikeUrl(text) });
  }
  const urls = populated.filter((entry) => entry.url);
  if (urls.length === 0) {
    return {
      candidates: [],
      // Document-shaped keys that hold something other than a URL. Worth reporting: it is the
      // difference between "this store has no invoice documents" and "we could not read them".
      nonUrlKeys: populated.map((entry) => entry.key),
    };
  }
  urls.sort((a, b) => rankDocumentKey(a.key) - rankDocumentKey(b.key) || a.key.localeCompare(b.key));
  // Every URL candidate, best first. Selection is NOT finished here: `looksLikeUrl` only knows
  // that a string starts with http(s), and the real guard -- which checks the host, the path and
  // the extension -- runs a stage later. Returning one winner meant a malformed `originalDocUrl`
  // beat a perfectly good `docUrl` on its name, got refused downstream, and the order was
  // reported as having no document while the usable URL sat unread in the alternatives.
  return {
    candidates: urls,
    nonUrlKeys: populated.filter((entry) => !entry.url).map((entry) => entry.key),
  };
}

// The population pass. Applies the discovered key names to EVERY in-scope order.
function applyPatternsToPopulation(orders = [], discovered = { keys: [] }) {
  const numberKeys = discovered.keys.filter((key) => classifyMetaKey(key) === 'invoice-number');
  const documentKeys = discovered.keys.filter((key) => {
    const family = classifyMetaKey(key);
    return family === 'invoice-document' || family === 'document-address';
  });

  const records = [];
  for (const order of orders) {
    const meta = order.meta || {};
    const number = firstPopulated(meta, numberKeys);
    const document = selectDocument(meta, documentKeys);
    const best = document.candidates[0] || null;
    if (!number && !best && document.nonUrlKeys.length === 0) continue;
    records.push({
      orderId: order.id,
      number: number ? number.value : null,
      // The provisional pick. classifyRecord may move to a lower-ranked candidate if this one
      // turns out not to survive the URL guard, and rewrites these two fields when it does.
      documentUrl: best ? best.value : null,
      documentKey: best ? best.key : null,
      // Every candidate in rank order, so the choice is auditable and the fallback is possible.
      documentCandidates: document.candidates.map((entry) => ({ key: entry.key, value: entry.value })),
      documentAlternatives: document.candidates.slice(1).map((entry) => entry.key),
      nonUrlDocumentKeys: document.nonUrlKeys,
    });
  }
  return {
    records,
    scanned: orders.length,
    withNumber: records.filter((r) => r.number).length,
    withDocument: records.filter((r) => r.documentUrl).length,
    // Orders carrying a document-shaped key whose value is not a URL and no URL anywhere: these
    // are unread, not absent, and the report must not round them down to "no invoices".
    withUnreadableDocument: records.filter((r) => !r.documentUrl && r.nonUrlDocumentKeys.length > 0).length,
  };
}

// The strategy table. Signal D alone selects the action, because parked-versus-decommissioned is
// unknowable at migration time: the source site is always assumed to be going away.
//
// The action is decided PER DOCUMENT, not once for the store. A store can hold some invoices on
// its own filesystem and others on a provider's, and those want opposite treatment -- the first
// group is about to be deleted, the second is somebody else's archive. An earlier version picked
// one winning strategy and returned only that class of document, so a single WordPress-hosted PDF
// silently excluded every provider-hosted one even after the merchant opted in.
// Named from the shared registry, so the plan and the writer that consumes its approvals cannot
// drift onto two vocabularies that merely happen to agree today.
const { PLAN_ACTIONS } = require('../../../lib/payments-outcome-registry.js');
const approvalStamp = require('../../../lib/preservation-approval-stamp.js');
const ACTIONS = Object.freeze({
  PRESERVE: PLAN_ACTIONS[0],
  OFFER_PRESERVATION: PLAN_ACTIONS[1],
  REFERENCE_ONLY: PLAN_ACTIONS[2],
  REFUSED: PLAN_ACTIONS[3],
});

// A candidate that was not used, described without reproducing it. `redactUrlForLog` is what the
// unsafe report already uses, so one rule covers every place a rejected URL can surface.
function describeRejected(entry) {
  return {
    key: entry.candidate.key,
    reason: entry.classification.reason,
    redactedUrl: redactUrlForLog(entry.candidate.value),
  };
}

function classifyRecord(record, sourceSiteHost) {
  // Rank order first, but a name hint is not evidence: walk the candidates and take the best one
  // that the guard actually passes. Only if none of them passes is the order refused, and then on
  // the highest-ranked candidate's reason -- the one the merchant would look for.
  const candidates = Array.isArray(record.documentCandidates) && record.documentCandidates.length > 0
    ? record.documentCandidates
    : (record.documentUrl ? [{ key: record.documentKey || null, value: record.documentUrl }] : []);

  if (candidates.length === 0) {
    // Nothing importable either way, but the two cases are not the same thing and the report must
    // not merge them: "this order has only a number" versus "this order has document keys whose
    // values we could not read". The second is a gap in our reading, not in the store's data.
    const unreadable = Array.isArray(record.nonUrlDocumentKeys) && record.nonUrlDocumentKeys.length > 0;
    return {
      ...record,
      classification: null,
      action: ACTIONS.REFERENCE_ONLY,
      reason: unreadable ? 'document-unreadable' : 'number-only',
    };
  }

  const tried = candidates.map((candidate) => ({
    candidate,
    classification: classifyDocumentUrl(candidate.value, { sourceSiteHost }),
  }));
  const usable = tried.find((entry) => entry.classification.safe);

  if (!usable) {
    const first = tried[0];
    return {
      ...record,
      documentCandidates: undefined,
      documentUrl: first.candidate.value,
      documentKey: first.candidate.key,
      classification: first.classification,
      action: ACTIONS.REFUSED,
      reason: first.classification.reason,
      // Named so the report can say "all four candidates were refused", not just the one.
      refusedCandidates: tried.map((entry) => describeRejected(entry)),
    };
  }

  const chosen = {
    ...record,
    // The candidate VALUES are an input to classification, not an output of it. Carrying them
    // through put every rejected URL -- tokens, customer names and all -- inside the approval that
    // the plan hands on and anything downstream may log. The one URL that survives is the one
    // deliberately chosen for this order; the rest are named and redacted.
    documentCandidates: undefined,
    documentUrl: usable.candidate.value,
    documentKey: usable.candidate.key,
    documentAlternatives: candidates.filter((c) => c !== usable.candidate).map((c) => c.key),
    // Better-named candidates that the guard rejected. A merchant seeing the copy preserved when
    // an "original" key existed can find out here why the original was not the one used.
    skippedCandidates: tried.slice(0, tried.indexOf(usable)).map((entry) => describeRejected(entry)),
    classification: usable.classification,
  };
  if (usable.classification.location === 'wordpress') {
    // These bytes die with the source site, so they are re-hosted without asking.
    return { ...chosen, action: ACTIONS.PRESERVE, reason: 'wordpress-hosted' };
  }
  // A provider or accounting archive survives the migration but not the merchant leaving that
  // provider, so it is referenced by default and copied only on an explicit opt-in.
  return { ...chosen, action: ACTIONS.OFFER_PRESERVATION, reason: 'third-party-hosted' };
}

function selectInvoiceStrategy({ signalA = 0, records = [], sourceSiteHost = null } = {}) {
  const documents = records.map((record) => classifyRecord(record, sourceSiteHost));

  const byAction = (action) => documents.filter((document) => document.action === action);
  const wordpressHosted = byAction(ACTIONS.PRESERVE);
  const thirdPartyHosted = byAction(ACTIONS.OFFER_PRESERVATION);
  const numbersOnly = byAction(ACTIONS.REFERENCE_ONLY);
  const refused = byAction(ACTIONS.REFUSED);

  // The report needs one label. A store carrying both kinds is reported as mixed rather than as
  // whichever kind happened to win.
  let strategy = STRATEGIES.NONE_FOUND;
  if (wordpressHosted.length > 0 && thirdPartyHosted.length > 0) strategy = STRATEGIES.MIXED;
  else if (wordpressHosted.length > 0) strategy = STRATEGIES.WORDPRESS_HOSTED;
  else if (thirdPartyHosted.length > 0) strategy = STRATEGIES.THIRD_PARTY_HOSTED;
  else if (numbersOnly.length > 0 || signalA > 0) strategy = STRATEGIES.NUMBER_ONLY;

  return {
    strategy,
    requiresMerchantOptIn: thirdPartyHosted.length > 0,
    documents,
    counts: {
      documentsFound: wordpressHosted.length + thirdPartyHosted.length,
      wordpressHosted: wordpressHosted.length,
      thirdPartyHosted: thirdPartyHosted.length,
      numberOnly: numbersOnly.filter((document) => document.reason === 'number-only').length,
      // Orders carrying document-shaped keys we could not read. Counted apart from numberOnly so a
      // merchant is never told "no invoice documents" when the truth is "we could not read them".
      unreadableDocuments: numbersOnly.filter((document) => document.reason === 'document-unreadable').length,
      unsafeUrls: refused.length,
      wordpressIssuedRows: signalA,
    },
    unsafe: refused.map((document) => ({
      orderId: document.orderId,
      reason: document.reason,
      redactedUrl: redactUrlForLog(document.documentUrl),
      // Every candidate that was tried, not only the one that happens to be reported.
      candidates: document.refusedCandidates || [],
    })),
    // The keys we found but could not read, so this is fixable rather than merely counted.
    unreadable: numbersOnly
      .filter((document) => document.reason === 'document-unreadable')
      .map((document) => ({ orderId: document.orderId, keys: document.nonUrlDocumentKeys })),
  };
}

// What may actually be imported. Every document is accounted for: importable, awaiting an opt-in
// the merchant declined, kept as a reference, or refused as unsafe.
function resolvePreservationPlan({ selection, merchantOptedIn = false } = {}) {
  // The writer requires an approval naming the exact URL, with an action that permits an import
  // and -- for a third-party archive -- the merchant's opt-in recorded ON the approval. Returning
  // the bare discovery record meant every opted-in document was refused at the writer, because
  // the consumer's precondition was never part of what the producer emitted.
  // Stamped, so the writer can tell an approval this planner issued from one assembled by hand
  // (see lib/preservation-approval-stamp.js). Every approval is stamped, not only opted-in ones,
  // so a stamp's absence is always meaningful.
  const approve = (document) => approvalStamp.stampApproval({ ...document, merchantOptedIn: merchantOptedIn === true });
  const importable = selection.documents
    .filter((document) => document.action === ACTIONS.PRESERVE
      || (document.action === ACTIONS.OFFER_PRESERVATION && merchantOptedIn === true))
    .map(approve);
  const refused = selection.documents.filter((document) => document.action === ACTIONS.OFFER_PRESERVATION
    && merchantOptedIn !== true);
  // A number-only record has no document to import, but its NUMBER must still be retained, so it
  // needs an approval the writer accepts as well.
  const referenceOnly = selection.documents.filter((document) => document.action === ACTIONS.REFERENCE_ONLY).map(approve);
  const unsafe = selection.documents.filter((document) => document.action === ACTIONS.REFUSED);

  const accounted = importable.length + refused.length + referenceOnly.length + unsafe.length;
  if (accounted !== selection.documents.length) {
    throw new Error(`invoice preservation plan accounts for ${accounted} of ${selection.documents.length} documents`);
  }

  return {
    importable,
    refused,
    referenceOnly,
    unsafe,
    reason: refused.length > 0 ? 'invoice-preservation-declined' : null,
  };
}

module.exports = {
  INVOICE_KEY_PATTERNS,
  STRATEGIES,
  ACTIONS,
  classifyMetaKey,
  discoverInvoicePatterns,
  applyPatternsToPopulation,
  isPrivateHostname,
  classifyDocumentUrl,
  redactUrlForLog,
  classifyRecord,
  selectInvoiceStrategy,
  resolvePreservationPlan,
};
