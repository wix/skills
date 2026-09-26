// Payment-gateway configuration, reduced to what discovery legitimately needs.
//
// WHAT THIS MODULE IS: a pure reducer. Gateway JSON in, summary out. It makes no request and
// imports no transport, so there is no arrangement of callers in which it can reach a live
// site. The transport (`wp-http.js`) imports THIS module, never the reverse -- that direction
// is the whole design. The alternative, a "sanctioned reader" module that owns both the
// request and the reduction, needs an escape hatch out of the transport's deny rule, and an
// escape hatch is the exposure with extra steps.
//
// WHY IT EXISTS: `GET /wc/v3/payment_gateways` returns each gateway's entire settings object,
// API keys and secrets included. Enumerating gateways is the obvious first move for any
// payments discovery step, so on a site with a real gateway connected the credential arrives
// through correct-looking work with no bad intent and no code change. Anything a tool returns
// is in the model's context, the transcript, and potentially the run artifacts, so there is no
// careful-handling mitigation available above this line. The value has to be dropped here.
//
// THE DEFAULT IS VALUE-FREE. A field's NAME and STATE are reported without its value, which is
// what discovery actually needs -- which gateways are registered, which are enabled, whether a
// credential is configured. Only a short reviewed allowlist of display and behaviour fields
// returns a value at all, and even those pass the shared secret-shape guard first, because
// `description` is free text a vendor or an attacker controls. Matching credential-shaped
// field NAMES and passing everything else through was the earlier design and it was the wrong
// trade: a field called `terminal_number` defeats it, and no name list can anticipate what a
// gateway vendor calls its key.

import { REDACTED, isSecretShaped, isUsable, unusableReason } from './secret-value-guard.js';

/** The one route this module's output can describe. Reported so a reader knows what was read. */
export const GATEWAY_COLLECTION_ROUTE = '/wc/v3/payment_gateways';

/** Request-level outcomes. A SEPARATE axis from field state -- see FIELD_STATES. */
export const REQUEST_OUTCOMES = Object.freeze(['ok', 'unauthorized', 'unreachable', 'malformed']);

/**
 * Field states, and the whole vocabulary.
 *
 *   present  the field exists and holds a non-empty value
 *   blank    the field exists and is empty
 *   absent   the gateway does not define this field
 *
 * Spec 0062's `local_present` / `secret_present` / `missing` / `placeholder` describe secret
 * RESOLUTION across a local env file and a secret store. That is a different question from
 * inspecting a live gateway field, and the two vocabularies must not be merged. What IS
 * inherited from 0062 is its output contract: tooling emits names and states, and emits a
 * value only where a reviewed allowlist says the field is display configuration.
 */
export const FIELD_STATES = Object.freeze(['present', 'blank', 'absent']);

/**
 * Fields whose VALUES may be returned, because a mapper genuinely needs them. Display text and
 * behavioural configuration -- never credentials.
 *
 * Adding an entry is a one-line reviewable decision. Failing to predict what a vendor calls its
 * credential is not, which is why this is an allowlist of values rather than a denylist of
 * names. An unrecognised field costs its value, not discovery: the caller still learns the
 * field exists and whether it is set.
 */
export const VALUE_ALLOWLIST = Object.freeze([
  'title',
  'description',
  'enabled',
  'order',
  'order_status',
  'method_title',
  'method_description',
  'instructions',
  'testmode',
  'test_mode',
  'checkout_label',
]);

/**
 * Spec 0062's credential-like name list, kept here as belt and braces rather than as the
 * control. If a field is on VALUE_ALLOWLIST and ALSO reads as a credential name, the allowlist
 * itself is wrong; the value is dropped and a warning is recorded rather than resolving the
 * contradiction silently in either direction.
 */
const CREDENTIAL_NAME_FRAGMENTS = Object.freeze([
  'password', 'secret', 'token', 'apikey', 'consumerkey', 'authorization', 'cookie', 'privatekey',
]);

/**
 * Properties of the gateway object that the summary reports in their own right, so they are not
 * repeated as fields.
 */
const HOISTED_PROPERTIES = new Set([
  'id', 'title', 'enabled', 'order', 'settings',
  // REST envelope, not gateway configuration: `_links` holds hrefs back to the same routes the
  // transport refuses. Dropping it entirely keeps the summary about the gateway.
  '_links',
]);

/**
 * Properties WooCommerce's payment-gateway schema declares on every gateway. Listing them is
 * what makes `absent` a real observation instead of a state nothing can ever produce: a gateway
 * that omits `method_description` is reported `absent`, distinct from one that defines it empty.
 */
const DECLARED_GATEWAY_FIELDS = Object.freeze(['description', 'method_title', 'method_description', 'method_supports']);

/** Sentinel for "the gateway does not define this field". Not a value; never returned. */
const ABSENT = Symbol('absent');

/** Whether the shared secret-shape guard can run at all. See `guardUnusableReason`. */
export function guardIsOperational() {
  return isUsable();
}

/**
 * Why the guard cannot run, or null when it is fine.
 *
 * A caller that is about to read gateway configuration must check this FIRST and refuse the
 * read rather than proceed unguarded. A guard that silently evaluates an empty pattern set
 * returns values verbatim, which is the failure mode worth being loud about.
 */
export function guardUnusableReason() {
  return unusableReason();
}

function normalizeFieldName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isCredentialShapedName(name) {
  const normalized = normalizeFieldName(name);
  return CREDENTIAL_NAME_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/**
 * A WooCommerce settings entry is `{ id, label, type, value, default, ... }`; some gateways and
 * some plugins hand back the bare value instead. Both are accepted, and neither the label nor
 * the tip is read -- only whether there is a value and, for an allowlisted field, what it is.
 */
function settingEntryValue(entry) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry) && Object.hasOwn(entry, 'value')) {
    return entry.value;
  }
  return entry;
}

/**
 * Whether a returnable string is, or CONTAINS, a secret-shaped token.
 *
 * The shared guard matches a whole value, prefix-not-substring — deliberately, because that is
 * what keeps a 44-character payment-pointer id from being eaten by the long-opaque rule on the
 * plugin's side, where a column value IS the whole value. Here the returnable fields are free
 * text: `description` is a paragraph a merchant typed, and a support key pasted mid-sentence
 * would sail through a whole-value check.
 *
 * So the same guard is applied at token granularity. This never widens what counts as
 * secret-shaped — every verdict still comes from the one canonical manifest — it only asks the
 * question of each token as well as of the whole string. A hit redacts the WHOLE value, never
 * the surrounding words: returning "Pay securely. Support key [REDACTED]" would confirm exactly
 * where the credential sits and how the rest of the sentence reads.
 */
function containsSecretShapedToken(text) {
  if (isSecretShaped(text)) return true;
  for (const token of text.split(/[\s,;:"'<>()[\]{}]+/)) {
    if (token && token !== text && isSecretShaped(token)) return true;
  }
  return false;
}

function stateOf(value) {
  if (value === ABSENT) return 'absent';
  if (value === null || value === undefined || value === '') return 'blank';
  if (Array.isArray(value)) return value.length === 0 ? 'blank' : 'present';
  if (typeof value === 'object') return Object.keys(value).length === 0 ? 'blank' : 'present';
  return 'present';
}

/**
 * Whether one field's value may be returned, and in what form.
 *
 * Returns `{ include, value?, warning?, redacted? }`. `include: false` means the `value`
 * property is omitted from the field entry ENTIRELY -- not `null`, not `''` -- so "we withheld
 * this" stays distinguishable from "this field is empty", which is what `state: "blank"` means.
 *
 * `allowlist` is a parameter so the allowlist/credential-name contradiction can be exercised
 * directly by a test; there is no name on the shipped allowlist that is also credential-shaped,
 * and there had better never be. It is safe as a seam because this function is pure and decides
 * only what to do with a value the caller already holds -- it grants no access to anything.
 * `reduceGatewayResponse` always uses the default, and nothing else in the read path takes an
 * allowlist at all.
 */
export function valueDecision(name, state, value, allowlist = VALUE_ALLOWLIST) {
  if (!allowlist.includes(name)) {
    return { include: false };
  }
  if (isCredentialShapedName(name)) {
    return {
      include: false,
      warning: `field "${name}" is on the value allowlist and also reads as a credential name — value dropped; fix the allowlist`,
    };
  }
  if (state !== 'present') {
    // `blank` and `absent` have no value to return, and `state` already says so.
    return { include: false };
  }
  if (typeof value === 'string') {
    // The allowlist grants permission to return A value. It never grants permission to skip the
    // guard: an allowlisted field is display text under vendor control, and nothing stops
    // `description` holding a pasted live key.
    if (containsSecretShapedToken(value)) {
      return { include: true, value: REDACTED, redacted: true };
    }
    return { include: true, value };
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { include: true, value };
  }
  // An object or array under an allowlisted name would carry unmodelled properties straight
  // through the summary. Report that it is set; do not carry its shape.
  return {
    include: false,
    warning: `field "${name}" is allowlisted but holds a ${Array.isArray(value) ? 'list' : 'structured'} value — value withheld`,
  };
}

function guardedText(value) {
  if (typeof value !== 'string') return null;
  return containsSecretShapedToken(value) ? REDACTED : value;
}

function reduceGateway(gateway, totals, warnings) {
  const settings = gateway && typeof gateway.settings === 'object' && !Array.isArray(gateway.settings)
    ? gateway.settings
    : {};

  // Settings win over a same-named top-level property: WooCommerce mirrors `description` and
  // `title` into both, and the settings entry is the one that holds what the merchant configured.
  const values = new Map();
  for (const [key, value] of Object.entries(gateway)) {
    if (HOISTED_PROPERTIES.has(key)) continue;
    values.set(key, value);
  }
  for (const [key, entry] of Object.entries(settings)) {
    values.set(key, settingEntryValue(entry));
  }
  for (const declared of DECLARED_GATEWAY_FIELDS) {
    if (!values.has(declared)) values.set(declared, ABSENT);
  }

  const fields = [];
  for (const name of [...values.keys()].sort()) {
    const raw = values.get(name);
    const state = stateOf(raw);
    if (state === 'present') totals.fieldsPresent += 1;

    const decision = valueDecision(name, state, raw);
    if (decision.warning) warnings.push(`${gateway.id ?? 'unknown gateway'}: ${decision.warning}`);

    // Built key by key, never spread from the source object: a raw-response property that is
    // not modelled here must not be able to ride along into the summary.
    const field = { name: String(name), state };
    if (decision.include) {
      field.value = decision.value;
      totals.valuesReturned += 1;
      if (decision.redacted) totals.valuesRedacted += 1;
    } else {
      totals.valuesWithheld += 1;
    }
    fields.push(field);
  }

  const order = Number.isFinite(Number(gateway.order)) && gateway.order !== '' && gateway.order !== null
    ? Number(gateway.order)
    : null;

  return {
    id: guardedText(gateway.id),
    title: guardedText(gateway.title),
    enabled: gateway.enabled === true || gateway.enabled === 'yes',
    order,
    fields,
  };
}

/**
 * Reduce a `wc/v3/payment_gateways` response to the summary schema.
 *
 * Input is the transport's result shape (`{ ok, status, json }`) -- plain data, not a client.
 * Output carries ONLY the properties defined here. Never a prefix or suffix of a withheld
 * value, never its length, never a hash of it, never whether two fields are equal.
 *
 * A failed request yields ZERO field entries rather than a page of `absent`, so "this gateway
 * has no API key" can never be confused with "we could not ask".
 */
export function reduceGatewayResponse(response) {
  const warnings = [];
  const totals = { gateways: 0, enabled: 0, fieldsPresent: 0, valuesReturned: 0, valuesWithheld: 0, valuesRedacted: 0 };
  const empty = (outcome) => ({ route: GATEWAY_COLLECTION_ROUTE, outcome, gateways: [], totals, warnings });

  if (!response || typeof response !== 'object') {
    return empty('unreachable');
  }
  if (response.status === 401 || response.status === 403) {
    return empty('unauthorized');
  }
  if (!response.ok) {
    return empty('unreachable');
  }
  if (!Array.isArray(response.json)) {
    return empty('malformed');
  }

  const gateways = [];
  for (const entry of response.json) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      warnings.push('a gateway entry was not an object and was skipped');
      continue;
    }
    const gateway = reduceGateway(entry, totals, warnings);
    totals.gateways += 1;
    if (gateway.enabled) totals.enabled += 1;
    gateways.push(gateway);
  }

  return { route: GATEWAY_COLLECTION_ROUTE, outcome: 'ok', gateways, totals, warnings };
}

/**
 * One line for the approval gate's plan report (spec 0123 §6). A run that states what it read
 * and what it retained is auditable; one that silently read the settings blob is not.
 */
export function describeGatewaySummary(summary) {
  if (!summary || summary.outcome !== 'ok') {
    return `Payment gateways: not read (${summary?.outcome ?? 'unreachable'}); no gateway configuration retained.`;
  }
  const t = summary.totals;
  return `Payment gateways: read ${summary.route} — ${t.gateways} registered, ${t.enabled} enabled, `
    + `${t.fieldsPresent} configured field(s), ${t.valuesWithheld} value(s) withheld, `
    + `${t.valuesRedacted} redacted, ${t.valuesReturned} display value(s) retained. No credential value retained.`;
}
