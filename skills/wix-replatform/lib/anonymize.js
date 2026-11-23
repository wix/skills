'use strict';

// Anonymizer for everything that leaves a migration run: reports, logs, journal rows, PR text,
// test fixtures, suggestions and telemetry (design v2, task D2).
//
// Deterministic pseudonyms: within one salt (one project), the same real value always becomes
// the same fake value, so links between records survive (a customer's email in customer.ndjson
// and in order.ndjson's billing.email map to the same fake email). Values are normalized before
// hashing (emails lower-cased, phones reduced to digits) so trivially different spellings of one
// real value still link.
//
// Shape is kept: an email stays a valid email (on a reserved example.* domain), a phone keeps its
// separators and digit count, an IP stays an IP (in a documentation range), Hebrew stays Hebrew,
// empty stays empty, and non-string values are left alone.
//
// Reuses, does not duplicate:
//   - rp-source-wordpress/lib/secret-value-guard.js `redact` for secret-shaped strings (tokens,
//     keys) found anywhere, including free text.
//   - the field families in rp-source-shopify/lib/shopify-protected-fields.js (name, email,
//     phone, address) -- the same four kinds, extended to WooCommerce/Wix field names plus
//     company, IP, notes and handles.
//
// Not a guarantee: classification is by field name, plus a text scrub for emails, phones, IPs,
// secret-shaped values and every real value this anonymizer has already replaced. A person's
// name inside free text under an unrecognized key is caught only if that name was seen in a
// recognized field first. Anonymize records before scrubbing logs/reports with the same instance.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const secretGuard = require('../resources/rp-source-wordpress/lib/secret-value-guard.js');

const SALT_FILE = 'state/anonymize-salt';

// Invented, name-like words: a fake name never equals a real person's (#729 privacy scan).
const LATIN_FIRST = ['Testa', 'Sampla', 'Demora', 'Fixon', 'Mocka', 'Placida', 'Exemplo', 'Dumora', 'Specia', 'Templo', 'Proxa', 'Stubbin', 'Fauxlin', 'Ficta', 'Nomina', 'Sima', 'Pseuda', 'Varia', 'Alias', 'Deco'];
const LATIN_LAST = ['Examplesson', 'Sampleman', 'Fixtureberg', 'Testington', 'Mockwood', 'Placeholderly', 'Demoford', 'Dummyfield', 'Specimenko', 'Templeworth', 'Proxington', 'Stubbsworth', 'Fauxley', 'Fictorsen', 'Nominova', 'Pseudoni', 'Variaston', 'Aliasby', 'Decoyman', 'Mimicson'];
const HEB_FIRST = ['דוגמית', 'בדיקון', 'דמיונה', 'ניסיונית', 'מבחנון', 'תבניתה', 'פיקציון', 'דגימית', 'מדומה', 'שרטוטית', 'דוגמון', 'בדיקית', 'דמיון', 'ניסיון', 'מבחנית', 'תבנון', 'פיקטית', 'דגימון', 'מדמית', 'שרטוטון'];
const HEB_LAST = ['דוגמאי', 'בדיקוביץ', 'ניסיונוב', 'מבחנקר', 'דמיוני', 'תבניתי', 'פיקציונר', 'דגימאי', 'מדומיאן', 'שרטוטי', 'דוגמוביץ', 'בדיקאי', 'ניסיונר', 'מבחנוב', 'דמיונוביץ', 'תבנוני', 'פיקטיבי', 'דגימוב', 'מדומוביץ', 'שרטוטוב'];
const LATIN_STREET = ['Example St', 'Sample Ave', 'Fixture Rd', 'Placeholder Ln', 'Testing Way', 'Mock Dr', 'Demo Ct', 'Dummy Blvd', 'Specimen St', 'Template Rd'];
// Invented words, so a fake address never equals a real one (#729 privacy scan).
const HEB_STREET = ['הדוגמה', 'הבדיקה', 'הדמה', 'הניסוי', 'המבחן', 'התבנית', 'הפיקציה', 'הדגימה', 'המדומה', 'השרטוט'];
const LATIN_CITY = ['Exampleton', 'Sampleville', 'Fixtureburg', 'Testford', 'Mockbury', 'Demotown', 'Placeholder City', 'Dummyport'];
const HEB_CITY = ['קרית הדוגמה', 'נווה בדיקה', 'כפר הדמה', 'גבעת ניסוי', 'רמת המבחן', 'מצפה תבנית', 'עין הדגימה', 'גני הפיקציה'];
const LATIN_WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua'];
const HEB_WORDS = ['טקסט', 'לדוגמה', 'בלבד', 'הערה', 'כללית', 'על', 'ההזמנה', 'תודה', 'רבה', 'בבקשה', 'משלוח', 'מהיר', 'שלום', 'יום', 'טוב', 'אחר', 'צהריים', 'בערב'];
const COMPANY_SUFFIX = ['Ltd', 'Inc', 'Co', 'Studio', 'Group', 'Works'];
const HEB_COMPANY_SUFFIX = ['בעמ', 'ושות\'', 'סטודיו', 'קבוצה'];
const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net'];
const IPV4_NETS = ['192.0.2', '198.51.100', '203.0.113'];
const GENERIC_USER_AGENT = 'Mozilla/5.0 (anonymized)';

const HEBREW = /[֐-׿]/;
// Hosts that are not the store's: never rewritten. Everything else is (default deny).
const PUBLIC_HOST = /(^|\.)(example\.(com|org|net|invalid|test)|wix\.com|wixapis\.com|wixstatic\.com|wixsite\.com|gravatar\.com|schema\.org|w\.org|wordpress\.org|woocommerce\.com|google\.com|googleapis\.com|gstatic\.com|facebook\.com|youtube\.com|instagram\.com)$/;
// scheme + host of a URL, also inside JSON-escaped text (https:\/\/host).
const URL_HOST_IN_TEXT = /(https?:(?:\\?\/){2})([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+)/g;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// Gravatar URLs (path = hash of the email), also inside JSON-escaped HTML (`https:\/\/...`).
const GRAVATAR_IN_TEXT = /https?:(?:\\?\/){2}[A-Za-z0-9.-]*gravatar\.com(?:\\?\/)avatar(?:\\?\/)[0-9a-fA-F]{32,64}/g;
// Yoast SEO person ids: a hash of the WordPress user login and id.
// The toolkit's own guest-buyer key is sha256(normalized email) (order-buyer.js): re-key it.
const GUEST_KEY_IN_TEXT = /(replatform:guest-buyer:)([0-9a-f]{32})/g;
const PERSON_HASH_IN_TEXT = /(schema(?:\\?\/)person(?:\\?\/))([0-9a-fA-F]{32,64})/g;
const IPV4_IN_TEXT = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
// Five or more groups, so clock times (12:30:45) never match. Compressed (::) forms are missed.
const IPV6_IN_TEXT = /\b(?:[0-9a-fA-F]{1,4}:){4,7}[0-9a-fA-F]{1,4}\b/g;
// Conservative: international (+) or trunk-prefixed (0) numbers of 9-15 digits with optional
// separators. Dates, prices and plain ids do not start with + or 0 followed by 8+ more digits.
const PHONE_IN_TEXT = /(?:\+|\b0)\d(?:[\s().-]?\d){7,13}\b/g;

// ---------- field classification ----------

// Normalized parent keys under which a bare `name` is a person (billing, shippingAddress, buyerInfo...),
// but not shipping_lines, line_items or a product.
const PERSON_PARENT = /^(?:(?:billing|shipping|customer|contact|author|user|recipient|member|buyer|owner|person|profile)(?:_(?:address|info|details|contact))?|address|contact_details)$/;

function normKey(key) {
  return String(key || '').replace(/^_+/, '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
    .replace(/^(billing|shipping)_/, '');
}

// Returns the kind for a field, or null (leave as is, still text-scrubbed).
function classifyField(key, parentKey = '') {
  const k = normKey(key);
  const parent = normKey(parentKey);
  if (!k) return null;
  if (/(^|_)(password|passwd|secret|api_key|access_token|auth_token|refresh_token|session_token|private_key)$/.test(k)) return 'secret';
  // Browser cookies a plugin logged (login cookies carry the username and a session token).
  if (/^(cookie|cookies|set_cookie|http_cookie)$/.test(k) || (k === 'value' && /(^|_)cookies?$/.test(parent))) return 'secret';
  if (/(^|_)e?mail(_address)?$/.test(k) || /^(email_restrictions|allowed_emails|customer_emails?)$/.test(k)) return 'email';
  // Coupon usage: who used it, by email or WordPress user id.
  if (/^(used_by|usedby|redeemed_by)$/.test(k)) return 'userRef';
  if (/(^|_)(phone|mobile|tel|telephone|fax|cell)(_number)?$/.test(k)) return 'phone';
  if (/^(first_name|firstname|given_name|fname)$/.test(k) || (k === 'first' && parent === 'name')) return 'firstName';
  if (/^(last_name|lastname|family_name|surname|lname)$/.test(k) || (k === 'last' && parent === 'name')) return 'lastName';
  // Values under a gravatar map ({"24": url, "48": url}): the path is the MD5 of the person's email.
  if (/avatar_urls?$/.test(parent)) return 'avatar';
  if (/^(full_name|display_name|nickname|reviewer|commenter)$/.test(k)
    || /(^|_)(billing|shipping|contact|recipient|customer|author|buyer|card_?holder|holder|payer|member)_name$/.test(k)) return 'fullName';
  if (k === 'name' && PERSON_PARENT.test(parent)) return 'fullName';
  if (/^(username|user_login|login|user_nicename|handle|slug_user)$/.test(k)) return 'handle';
  if (/^(address_?\d?|address_line_?\d?|street(_address)?|street_\d|line_?\d|formatted(_address)?)$/.test(k)) return 'street';
  if (/(identification|id_number|national_id|tax_id|vat_number|vat_id|passport|ssn|teudat)/.test(k)) return 'code';
  if (/(last_?4|four_digits|card_?number|credit[-_]?card|cc_number|card_mask|expiry|exp_month|exp_year)/.test(k)) return 'code';
  if (/(authnr|approval_num|voucher_num|voucher_id|transaction_uid|auth_code)/.test(k)) return 'code';
  if (/^(postcode|post_code|postal_code|zip|zip_code|zipcode)$/.test(k)) return 'postcode';
  if (k === 'city' || k === 'town') return 'city';
  if (k === 'company' || k === 'company_name') return 'company';
  if (/(^|_)ip(_address)?$|^remote_addr$/.test(k)) return 'ip';
  if (/user_agent$/.test(k)) return 'userAgent';
  if (/^(latitude|longitude|lat|lng|lon)$/.test(k)) return 'coordinate';
  if (/(^|_)(note|notes|comment|comments|customer_message|message_to_seller|gift_message)$/.test(k)) return 'text';
  if (/^(transaction_id|order_key|cart_hash|payment_token|charge_id)$/.test(k)) return 'token';
  // Visitor tracking: campaign, click and analytics client ids identify a person's sessions.
  if (/^(utm_[a-z]+|gclid|fbclid|msclkid|ga_client_id|client_id|ga|gid|fbp|fbc)$/.test(k) || /(^|_)(client_id|visitor_id|session_id|uid|uuid)$/.test(k)) return 'code';
  if (/^(avatar_url|gravatar)$/.test(k)) return 'avatar';
  if (/(payment|invoice|doc|document|download|receipt|checkout|pay)_?(url|address|link|href)$/.test(k)) return 'url';
  if (/^(birthday|birth_date|date_of_birth|dob)$/.test(k)) return 'date';
  return null;
}

// ---------- the anonymizer ----------

function createAnonymizer({ salt, sourceHosts = [] } = {}) {
  if (!salt || typeof salt !== 'string') throw new Error('createAnonymizer needs a non-empty string salt (see loadProjectSalt)');
  const seen = new Map(); // real value -> fake value, for scrubText
  const fakes = new Set(); // fake values already produced, so a scrub never re-anonymizes them
  // Values faked under their field but never replaced in free text: a plain word that plugin
  // meta denies ("builder", "classic") is toolkit and product vocabulary too, and replacing it
  // everywhere garbles reasons and codes. Identifiers (a digit, an @, 20+ characters) still are.
  const weakValues = new Set();

  function digest(kind, normalized) {
    return crypto.createHmac('sha256', salt).update(`${kind}\u0000${normalized}`).digest();
  }
  function pick(list, buf, offset = 0, avoid = null) {
    const start = buf.readUInt16BE(offset % (buf.length - 1)) % list.length;
    const choice = list[start];
    // A real value that happens to be on the fake list must not map to itself.
    return choice === avoid ? list[(start + 1) % list.length] : choice;
  }
  function digitsFrom(buf, count, offset = 0) {
    let out = '';
    for (let i = 0; i < count; i += 1) out += String(buf[(offset + i) % buf.length] % 10);
    return out;
  }
  function remember(real, fake) {
    if (typeof fake === 'string') fakes.add(fake);
    if (typeof real === 'string' && real.trim().length >= 3 && real !== fake) seen.set(real, fake);
    return fake;
  }

  function email(value) {
    if (typeof value !== 'string' || !value.trim()) return value;
    const normalized = value.trim().toLowerCase();
    const h = digest('email', normalized);
    const fake = `user.${h.toString('hex').slice(0, 10)}@${pick(EMAIL_DOMAINS, h, 6)}`;
    return remember(value, fake);
  }

  function phone(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return value;
    const str = String(value);
    const digits = str.replace(/\D/g, '');
    if (!digits) return value;
    const h = digest('phone', digits);
    // Keep '+', separators and digit count; keep a leading trunk '0' so local numbers still look local.
    let i = 0;
    const keepFirst = str.trim().startsWith('0');
    const replaced = str.replace(/\d/g, (d) => {
      const idx = i; i += 1;
      if (idx === 0 && keepFirst) return d;
      return String(h[idx % h.length] % 10);
    });
    remember(str, replaced);
    return typeof value === 'number' ? Number(replaced) : replaced;
  }

  function personPart(kind, value) {
    if (typeof value !== 'string' || !value.trim()) return value;
    const h = digest(kind, value.trim().toLowerCase());
    const heb = HEBREW.test(value);
    const list = kind === 'firstName' ? (heb ? HEB_FIRST : LATIN_FIRST) : (heb ? HEB_LAST : LATIN_LAST);
    return remember(value, pick(list, h, 0, value.trim()));
  }

  function fullName(value) {
    if (typeof value !== 'string' || !value.trim()) return value;
    const parts = value.trim().split(/\s+/);
    if (parts.length === 1) return remember(value, personPart('firstName', parts[0]));
    const first = personPart('firstName', parts[0]);
    const last = personPart('lastName', parts.slice(1).join(' '));
    return remember(value, `${first} ${last}`);
  }

  function handle(value) {
    if (typeof value !== 'string' || !value.trim()) return value;
    if (value.includes('@')) return email(value);
    const h = digest('handle', value.trim().toLowerCase());
    return remember(value, `user_${h.toString('hex').slice(0, 8)}`);
  }

  function street(value) {
    if (typeof value !== 'string' || !value.trim()) return value;
    const h = digest('street', value.trim().toLowerCase());
    const heb = HEBREW.test(value);
    const hasNumber = /\d/.test(value);
    const num = 1 + (h.readUInt16BE(2) % 199);
    const name = pick(heb ? HEB_STREET : LATIN_STREET, h);
    let fake;
    if (heb) fake = hasNumber ? `${name} ${num}` : name;
    else fake = hasNumber ? `${num} ${name}` : name;
    return remember(value, fake);
  }

  // Keeps length and layout: digits stay digits, letters stay letters (case kept), the rest stays.
  function code(value, kind = 'code') {
    if (typeof value !== 'string' && typeof value !== 'number') return value;
    const str = String(value);
    if (!str.trim()) return value;
    const h = digest(kind, str.trim().toUpperCase());
    let i = 0;
    // Every letter is replaced, Hebrew with Hebrew (and any other script with Latin): keeping
    // non-Latin letters let Hebrew plugin text pass a "deny" unchanged (#729 privacy scan).
    const replaced = str.replace(/[0-9]/g, () => String(h[(i++) % h.length] % 10))
      .replace(/[A-Za-z]/g, (c) => {
        const ch = String.fromCharCode(65 + (h[(i++) % h.length] % 26));
        return c === c.toLowerCase() ? ch.toLowerCase() : ch;
      })
      .replace(/[\u05D0-\u05EA]/g, () => String.fromCharCode(0x05D0 + (h[(i++) % h.length] % 27)))
      .replace(/(?![\u05D0-\u05EAA-Za-z])\p{L}/gu, () => String.fromCharCode(97 + (h[(i++) % h.length] % 26)));
    remember(str, replaced);
    if (kind === 'meta' && plainWords(str)) weakValues.add(str);
    return typeof value === 'number' ? Number(replaced) : replaced;
  }

  function plainWords(str) { return str.trim().length < 20 && /^\p{L}+(?:[ _-]\p{L}+)*$/u.test(str.trim()); }

  function postcode(value) { return code(value, 'postcode'); }

  function city(value) {
    if (typeof value !== 'string' || !value.trim()) return value;
    const h = digest('city', value.trim().toLowerCase());
    return remember(value, pick(HEBREW.test(value) ? HEB_CITY : LATIN_CITY, h, 0, value.trim()));
  }

  function company(value) {
    if (typeof value !== 'string' || !value.trim()) return value;
    const h = digest('company', value.trim().toLowerCase());
    const heb = HEBREW.test(value);
    // "Sample"/"דוגמה" in every fake company, so it never equals a real company name.
    const fake = heb ? `דוגמה ${pick(HEB_LAST, h)} ${pick(HEB_COMPANY_SUFFIX, h, 4)}` : `Sample ${pick(LATIN_LAST, h)} ${pick(COMPANY_SUFFIX, h, 4)}`;
    return remember(value, fake);
  }

  function ip(value) {
    if (typeof value !== 'string' || !value.trim()) return value;
    const v = value.trim();
    const h = digest('ip', v.toLowerCase());
    let fake;
    if (v.includes(':')) fake = `2001:db8::${h.toString('hex').slice(0, 4)}:${h.toString('hex').slice(4, 8)}`;
    else fake = `${pick(IPV4_NETS, h)}.${1 + (h[4] % 254)}`;
    return remember(value, fake);
  }

  function coordinate(value) {
    if (value === null || value === undefined || value === '') return value;
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    // Round to one decimal (~11 km): keeps the region, drops the house.
    const fake = Math.round(n * 10) / 10;
    return typeof value === 'number' ? fake : String(fake);
  }

  function text(value) {
    if (typeof value !== 'string' || !value.trim()) return value;
    const h = digest('text', value);
    const heb = HEBREW.test(value);
    const words = heb ? HEB_WORDS : LATIN_WORDS;
    const target = value.length;
    const out = [];
    let len = 0;
    let i = 0;
    while (len < target) {
      const w = words[h[i % h.length] % words.length];
      out.push(w);
      len += w.length + 1;
      i += 1;
    }
    let fake = out.join(' ');
    if (fake.length > target) fake = fake.slice(0, Math.max(1, target)).trimEnd();
    return remember(value, fake);
  }

  function token(value) {
    if (typeof value !== 'string' || !value.trim()) return value;
    const h = digest('token', value);
    const hex = crypto.createHash('sha256').update(h).digest('hex');
    // Keep a readable prefix like "wc_order_" and the length.
    const prefixMatch = value.match(/^[A-Za-z]+_(?:[A-Za-z]+_)?/);
    const prefix = prefixMatch ? prefixMatch[0] : '';
    const body = (hex + hex).slice(0, Math.max(0, value.length - prefix.length));
    return remember(value, prefix + body);
  }

  function avatar(value) {
    if (typeof value !== 'string' || !value.trim()) return value;
    // Keyed on the email hash in the path, so every size of one person's avatar gets one fake.
    const hash = value.match(/[0-9a-fA-F]{32,64}/);
    const h = digest('avatar', hash ? hash[0].toLowerCase() : value);
    return remember(value, `https://avatar.example.com/${h.toString('hex').slice(0, 32)}`);
  }

  // Links that open a customer's own document or payment page: keep scheme, host and route
  // words and plain numeric ids; replace mixed letter-digit path segments (UUIDs, tokens) and
  // query values that carry a digit or are long. A value already pseudonymized elsewhere in the
  // record (the order key) reuses that fake, so the link still matches.
  function urlSegment(seg) {
    if (!/\d/.test(seg) || /^\d+$/.test(seg)) return seg;
    if (seen.has(seg)) return seen.get(seg);
    const ext = seg.match(/(\.[A-Za-z]{2,5})$/);
    return ext ? `${code(seg.slice(0, -ext[1].length), 'url-path')}${ext[1]}` : code(seg, 'url-path');
  }

  function url(value) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return value;
    let parsed;
    try { parsed = new URL(value); } catch { return value; }
    parsed.username = '';
    parsed.password = '';
    parsed.hostname = fakeHost(parsed.hostname);
    parsed.pathname = parsed.pathname.split('/').map((seg) => urlSegment(seg)).join('/');
    for (const [k, v] of [...parsed.searchParams.entries()]) {
      if (v && (/\d/.test(v) || v.length >= 12)) parsed.searchParams.set(k, seen.get(v) ?? code(v, 'url-query'));
    }
    parsed.hash = '';
    return remember(value, parsed.href);
  }

  function date(value) {
    if (typeof value !== 'string' || !value.trim()) return value;
    // Keep the year only (Jan 1st), in the same layout when it is an ISO date.
    const m = value.match(/^(\d{4})-\d{2}-\d{2}(.*)$/);
    return m ? remember(value, `${m[1]}-01-01${m[2] ? m[2].replace(/\d/g, '0') : ''}`) : value;
  }

  function secret(value) {
    if (typeof value !== 'string' || !value) return value;
    return secretGuard.REDACTED;
  }

  const BY_KIND = {
    email, phone, firstName: (v) => personPart('firstName', v), lastName: (v) => personPart('lastName', v),
    fullName, handle, street, postcode, code: (v) => code(v), city, company, ip, coordinate, text, token, avatar, url, date, secret,
    userRef: (v) => (typeof v === 'string' && v.includes('@') ? email(v) : code(v, 'user-ref')),
    userAgent: (v) => (typeof v === 'string' && v ? GENERIC_USER_AGENT : v),
  };

  function value(v, kind) {
    const fn = BY_KIND[kind];
    if (!fn) throw new Error(`anonymize: unknown kind ${kind}`);
    return fn(v);
  }

  let knownRegex = null;
  let knownRegexSize = -1;
  function knownValuesPattern() {
    if (knownRegexSize === seen.size) return knownRegex;
    knownRegexSize = seen.size;
    if (!seen.size) { knownRegex = null; return null; }
    const alts = [...seen.keys()].filter((v) => !weakValues.has(v)).sort((a, b) => b.length - a.length)
      .map((v) => v.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
    // Whole words only, so a real first name "Dan" never rewrites "Danish".
    knownRegex = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
    return knownRegex;
  }

  // Free text: logs, PR bodies, report lines. Replaces every real value this instance has already
  // pseudonymized (whole words), then emails, IPs, phones and secret-shaped tokens.
  function scrubText(input, { knownValues = true } = {}) {
    if (typeof input !== 'string' || !input) return input;
    let out = input;
    const known = knownValues ? knownValuesPattern() : null;
    if (known) out = out.replace(known, (m) => seen.get(m) ?? m);
    out = out.replace(GRAVATAR_IN_TEXT, (m) => {
      const hash = m.match(/[0-9a-fA-F]{32,64}$/)[0];
      return m.slice(0, -hash.length) + digest('avatar', hash.toLowerCase()).toString('hex').slice(0, hash.length);
    });
    out = out.replace(GUEST_KEY_IN_TEXT, (_m, prefix, hash) => prefix + digest('guest-key', hash).toString('hex').slice(0, 32));
    out = out.replace(PERSON_HASH_IN_TEXT, (_m, prefix, hash) => prefix + digest('person-hash', hash.toLowerCase()).toString('hex').slice(0, hash.length));
    out = out.replace(EMAIL_IN_TEXT, (m) => (/@example\.(com|org|net)$/i.test(m) ? m : email(m)));
    out = out.replace(IPV4_IN_TEXT, (m) => (IPV4_NETS.some((net) => m.startsWith(`${net}.`)) ? m : ip(m)));
    out = out.replace(IPV6_IN_TEXT, (m) => (/^2001:db8:/i.test(m) ? m : ip(m)));
    out = out.replace(PHONE_IN_TEXT, (m) => (fakes.has(m) ? m : phone(m)));
    // The secret guard judges whole values; apply it per token so a key inside a log line goes too.
    out = out.replace(/[^\s"'<>,;()[\]{}=&?]+/g, (tok) => secretGuard.redact(tok));
    return out;
  }

  // ---- store hostnames ----
  // Every URL host outside a short public list becomes a stable fake host (path kept), and a host
  // seen in a URL is also replaced where text names it bare ("tuticafe.co.il"). Only record()
  // does this (fixtures, extracts, logs); reports keep real URLs for the operator.
  const hostMap = new Map();
  let hostPattern = null;
  function fakeHost(host) {
    const h = String(host).toLowerCase().replace(/\.$/, '');
    if (PUBLIC_HOST.test(h)) return h;
    const www = h.startsWith('www.') ? 'www.' : '';
    const base = www ? h.slice(4) : h;
    if (!hostMap.has(base)) {
      hostMap.set(base, `store-${digest('host', base).toString('hex').slice(0, 8)}.example.com`);
      hostPattern = null;
    }
    return www + hostMap.get(base);
  }
  for (const h of sourceHosts) fakeHost(h);
  function bareHosts() {
    if (hostPattern) return hostPattern;
    const alts = [...hostMap.keys()].filter((h) => h.includes('.') && h.length >= 6).sort((a, b) => b.length - a.length)
      .map((h) => h.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
    hostPattern = alts.length ? new RegExp(`(?<![A-Za-z0-9.-])(?:www\\.)?(?:${alts.join('|')})(?![A-Za-z0-9-])`, 'gi') : /(?!)/g;
    return hostPattern;
  }
  function scrubHosts(text) {
    let out = text.replace(URL_HOST_IN_TEXT, (m, scheme, host) => `${scheme}${fakeHost(host)}`);
    out = out.replace(bareHosts(), (m) => (PUBLIC_HOST.test(m.toLowerCase()) ? m : fakeHost(m)));
    return out;
  }

  // ---- WooCommerce meta_data: default deny ----
  // Plugins put anything in meta_data (analytics client ids, payment-provider invoices and
  // customer uids, page-request ids). A value is kept only when it cannot identify anyone (a flag,
  // a small number) or is a product attribute on a line item; everything else becomes a
  // same-shape fake, the same fake for the same value.
  function metaSafe(v, metaKey, context) {
    if (v === null || v === undefined || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Math.abs(v) < 100000;
    if (typeof v !== 'string') return false;
    if (/^(yes|no|true|false|on|off|y|n|0|1|-|)$/i.test(v.trim()) || /^\d{1,4}(\.\d{1,2})?$/.test(v.trim())) return true;
    // Product attributes (taxonomy `pa_*`) on a line item are store content. Custom keys can be
    // customer-typed text (a gift note), so they are denied too.
    if (context === 'line_items') return /^pa_/.test(metaKey) && v.length <= 60 && !/@|https?:|\d{6,}/.test(v);
    return false;
  }
  function metaDeny(v, key = '', parentKey = '') {
    if (Array.isArray(v)) return v.map((x) => metaDeny(x, key, parentKey));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, metaDeny(x, k, key)]));
    if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
      try { const inner = JSON.parse(v); if (inner && typeof inner === 'object') return JSON.stringify(metaDeny(inner, key, parentKey)); } catch { /* not JSON */ }
    }
    // A known personal field inside plugin data keeps its proper fake (same email -> same fake).
    const kind = key ? classifyField(key, parentKey) : null;
    if (kind && (typeof v === 'string' || (typeof v === 'number' && ['phone', 'postcode', 'code', 'coordinate', 'userRef'].includes(kind)))) return value(v, kind);
    if (typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return email(v);
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) return scrubHosts(url(v.trim()));
    if (typeof v === 'string') return v.trim() && !metaSafe(v, '_', 'deny') ? code(v, 'meta') : v;
    if (typeof v === 'number') return Math.abs(v) < 100000 ? v : code(v, 'meta');
    return v;
  }

  // Deep copy of a record with every recognized personal field replaced and every other string
  // text-scrubbed. WooCommerce `meta_data` rows ({key, value}) are classified by their `key`.
  function record(input, { parentKey = '', scrubStrings = true } = {}) {
    return walk(input, '', parentKey);

    function walk(node, key, parent) {
      if (Array.isArray(node)) return node.map((item) => walk(item, key, parent));
      if (node && typeof node === 'object') {
        if (typeof node.key === 'string' && Object.prototype.hasOwnProperty.call(node, 'value')) {
          const kind = classifyField(node.key, key);
          const context = normKey(parent);
          const out = {};
          for (const [k, v] of Object.entries(node)) {
            if (k !== 'value' && k !== 'display_value') { out[k] = walk(v, k, key); continue; }
            if (kind && (typeof v === 'string' || typeof v === 'number')) out[k] = value(v, kind);
            else if (key === 'meta_data' && !metaSafe(v, node.key, context)) out[k] = metaDeny(v);
            else out[k] = walk(v, k, key);
          }
          return out;
        }
        const out = {};
        for (const [k, v] of Object.entries(node)) out[k] = walk(v, k, key);
        return out;
      }
      const kind = classifyField(key, parent);
      if (kind && (typeof node === 'string' || (typeof node === 'number' && ['phone', 'postcode', 'code', 'coordinate', 'userRef'].includes(kind)))) return value(node, kind);
      // Plugins store JSON as strings (payment gateway payloads): anonymize inside, keep it a string.
      if (typeof node === 'string' && /^\s*[[{]/.test(node)) {
        let inner;
        try { inner = JSON.parse(node); } catch { inner = undefined; }
        if (inner && typeof inner === 'object') return JSON.stringify(walk(inner, key, parent));
      }
      // Unclassified strings get the pattern scrub only (fast on large extracts); the known-value
      // pass is for logs and reports via scrubText.
      if (typeof node === 'string' && scrubStrings) return scrubHosts(scrubText(node, { knownValues: false }));
      return node;
    }
  }

  // One value read at a known path (a Wix target path like `billingInfo.contactDetails.firstName`
  // or a source path like `billing.email`): classified by its last key and that key's parent.
  function valueAt(fieldPath, v) {
    if (v && typeof v === 'object') return record(v, { parentKey: String(fieldPath || '') });
    const parts = String(fieldPath || '').replace(/\[\]/g, '').split('.').filter(Boolean);
    const kind = classifyField(parts[parts.length - 1], parts[parts.length - 2] || '');
    if (kind && (typeof v === 'string' || (typeof v === 'number' && ['phone', 'postcode', 'code', 'coordinate'].includes(kind)))) return value(v, kind);
    return typeof v === 'string' ? scrubText(v) : v;
  }

  return { value, valueAt, record, scrubText, scrubHosts, fakeHost, classifyField, knownCount: () => seen.size, ...BY_KIND };
}

// The project salt lives in the project's state folder, is created once, and is never printed.
// Same project → same pseudonyms across runs; different projects → unrelated pseudonyms.
function loadProjectSalt(projectDir, { create = true } = {}) {
  const file = path.join(projectDir, SALT_FILE);
  if (fs.existsSync(file)) {
    const salt = fs.readFileSync(file, 'utf8').trim();
    if (salt) return salt;
  }
  if (!create) throw new Error(`anonymize: no salt at ${SALT_FILE} in the project`);
  const salt = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${salt}\n`, { mode: 0o600 });
  return salt;
}

function projectAnonymizer(projectDir) {
  return createAnonymizer({ salt: loadProjectSalt(projectDir) });
}

module.exports = {
  SALT_FILE,
  GENERIC_USER_AGENT,
  classifyField,
  createAnonymizer,
  loadProjectSalt,
  projectAnonymizer,
};
