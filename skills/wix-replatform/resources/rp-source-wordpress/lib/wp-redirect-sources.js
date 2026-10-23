'use strict';

const crypto = require('node:crypto');

// Source-authored WordPress redirect maps: provider discovery, table resolution and row
// normalization into `state/url-preservation/source-redirects.ndjson` definitions plus a
// per-provider coverage record.
//
// Redirect maps usually live in plugin tables, not in any public or REST surface: an empty
// REST answer is never evidence that no rules exist. Plugin tables are read through the
// structure bridge by BARE table name (the bridge owns the real prefix); `options` stays
// denied, so a provider that keeps rules there (Yoast Premium) needs an operator export.
// Coverage per provider is one of:
//   extracted        rows read completely
//   confirmed_empty  a complete, successful read returned zero rows
//   unreadable       read failed, partial, ambiguous or no channel
//   unsupported      rules live where this pipeline cannot read them (server/CDN, options)
// Logs, 404 records, hit counters and caches are never rules.

const PROVIDERS = Object.freeze({
  redirection: {
    displayName: 'Redirection',
    pluginSlugs: ['redirection'],
    tables: ['redirection_items', 'redirection_groups'],
    ruleTable: 'redirection_items',
  },
  'rank-math': {
    displayName: 'Rank Math SEO redirections',
    pluginSlugs: ['seo-by-rank-math', 'seo-by-rank-math-pro'],
    tables: ['rank_math_redirections'],
    ruleTable: 'rank_math_redirections',
  },
  'yoast-premium': {
    displayName: 'Yoast SEO Premium redirects',
    pluginSlugs: ['wordpress-seo-premium'],
    tables: [],
    storedIn: 'options',
  },
});

// Resolve a provider table among the discovered physical table names. The prefix is whatever
// the site uses; several matches (for example multisite sub-site tables) are ambiguous.
function resolveTable(bareName, physicalTables = [], { prefix = null } = {}) {
  if (prefix !== null) {
    const exact = `${prefix}${bareName}`;
    return physicalTables.includes(exact) ? { ok: true, physicalTable: exact } : { ok: false, reason: 'table_not_found' };
  }
  const matches = physicalTables.filter((name) => name.endsWith(bareName) && /^[A-Za-z0-9_]*$/.test(name.slice(0, -bareName.length)));
  if (matches.length === 1) return { ok: true, physicalTable: matches[0] };
  if (matches.length === 0) return { ok: false, reason: 'table_not_found' };
  return { ok: false, reason: 'ambiguous_table', candidates: matches };
}

// Minimal PHP unserialize for the scalar/array shapes plugins store (a, s, i, d, b, N).
// Works on bytes because PHP string lengths are byte counts.
function phpUnserialize(input) {
  const buf = Buffer.from(String(input), 'utf8');
  let pos = 0;
  function readUntil(byte) {
    const end = buf.indexOf(byte, pos);
    if (end < 0) throw new Error('php-unserialize: truncated');
    const value = buf.slice(pos, end).toString('utf8');
    pos = end + 1;
    return value;
  }
  function parse() {
    const type = String.fromCharCode(buf[pos]);
    if (type === 'N') { pos += 2; return null; }
    pos += 2;
    if (type === 'i') return Number.parseInt(readUntil(0x3b), 10);
    if (type === 'd') return Number.parseFloat(readUntil(0x3b));
    if (type === 'b') return readUntil(0x3b) === '1';
    if (type === 's') {
      const length = Number.parseInt(readUntil(0x3a), 10);
      if (buf[pos] !== 0x22) throw new Error('php-unserialize: expected quote');
      const value = buf.slice(pos + 1, pos + 1 + length).toString('utf8');
      pos += 1 + length + 2;
      return value;
    }
    if (type === 'a') {
      const count = Number.parseInt(readUntil(0x3a), 10);
      pos += 1; // {
      const entries = [];
      for (let i = 0; i < count; i += 1) entries.push([parse(), parse()]);
      pos += 1; // }
      const isList = entries.every(([key], index) => key === index);
      return isList ? entries.map(([, value]) => value) : Object.fromEntries(entries);
    }
    throw new Error(`php-unserialize: unsupported type ${type}`);
  }
  return parse();
}

function leadingSlash(value) {
  const v = String(value || '').trim();
  if (!v) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('/')) return v;
  return `/${v}`;
}

function toStatus(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) ? n : null;
}

function normalizeRedirectionRows(items, groups, { providerActive, physicalTable, extractedAt }) {
  const groupEnabled = new Map((groups || []).map((g) => [String(g.id), g.status === undefined || g.status === 'enabled']));
  const groupModule = new Map((groups || []).map((g) => [String(g.id), String(g.module_id || '1')]));
  return items.map((row) => {
    const conditions = [];
    let matchType = String(row.regex) === '1' || row.regex === true ? 'regex' : 'exact';
    const kind = row.match_type || 'url';
    if (kind === 'server') {
      let server = null;
      try { server = JSON.parse(row.match_data || '{}')?.source?.server || null; } catch { server = null; }
      let host = null;
      try { host = server ? new URL(server).hostname : null; } catch { host = null; }
      conditions.push(host ? { type: 'host', value: host } : { type: 'server' });
    } else if (kind !== 'url') {
      conditions.push({ type: kind });
    }
    if ((row.action_type || 'url') !== 'url') matchType = 'other';
    // Apache/Nginx module groups are server-config exports, not rules WordPress serves.
    if (groupModule.get(String(row.group_id)) && groupModule.get(String(row.group_id)) !== '1') conditions.push({ type: 'server_module' });
    const enabled = providerActive && row.status === 'enabled' && groupEnabled.get(String(row.group_id)) !== false;
    return {
      schemaVersion: 1,
      ruleKey: `redirection:${row.id}`,
      provider: 'redirection',
      storage: { kind: 'table', name: physicalTable },
      stableId: String(row.id),
      enabled,
      disabledReason: enabled ? null : (!providerActive ? 'provider_inactive' : 'rule_or_group_disabled'),
      matchType,
      source: row.url,
      destination: typeof row.action_data === 'string' && !row.action_data.startsWith('a:') ? row.action_data : null,
      statusCode: toStatus(row.action_code),
      priority: toStatus(row.position),
      conditions,
      language: null,
      extractedAt,
    };
  });
}

const RANK_MATH_COMPARISON = { exact: 'exact', start: 'prefix', end: 'suffix', contains: 'contains', regex: 'regex' };

function parseRankMathSources(value) {
  if (Array.isArray(value)) return value;
  const text = String(value || '');
  if (text.startsWith('[') || text.startsWith('{')) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : Object.values(parsed);
  }
  const parsed = phpUnserialize(text);
  return Array.isArray(parsed) ? parsed : Object.values(parsed || {});
}

function normalizeRankMathRows(rows, { providerActive, physicalTable, extractedAt }) {
  const out = [];
  const errors = [];
  for (const row of rows) {
    let sources;
    try {
      sources = parseRankMathSources(row.sources);
    } catch (error) {
      errors.push({ id: String(row.id), reason: `unparseable_sources: ${error.message}` });
      continue;
    }
    sources.forEach((source, index) => {
      const enabled = providerActive && row.status === 'active';
      const ignore = String((source && source.ignore) || '');
      out.push({
        schemaVersion: 1,
        ruleKey: `rank-math:${row.id}:${index}`,
        provider: 'rank-math',
        storage: { kind: 'table', name: physicalTable },
        stableId: `${row.id}:${index}`,
        sourceRuleId: `${row.id}:${crypto.createHash('sha256').update(String(source?.pattern || '')).digest('hex').slice(0, 16)}`,
        enabled,
        disabledReason: enabled ? null : (!providerActive ? 'provider_inactive' : `status_${row.status || 'unknown'}`),
        matchType: RANK_MATH_COMPARISON[source && source.comparison] || 'other',
        source: leadingSlash(source && source.pattern),
        destination: row.url_to ? leadingSlash(row.url_to) : null,
        statusCode: toStatus(row.header_code),
        priority: null,
        conditions: ignore.includes('case') ? [{ type: 'ignore_case' }] : [],
        language: null,
        extractedAt,
      });
    });
  }
  return { rules: out, errors };
}

// Minimal CSV (quoted fields, commas, CRLF) for operator-supplied exports.
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

// Operator export: header row with from/to/status (Yoast: origin/target/type/format).
function normalizeExportCsv(provider, text, { extractedAt, fileRef }) {
  const [header, ...rows] = parseCsv(String(text || ''));
  if (!header) return { rules: [], errors: [{ reason: 'empty_export' }] };
  const col = (names) => header.findIndex((h) => names.includes(h.trim().toLowerCase()));
  const from = col(['from', 'origin', 'source']);
  const to = col(['to', 'target', 'destination']);
  const status = col(['status', 'type', 'code']);
  const format = col(['format', 'match']);
  if (from < 0 || to < 0) return { rules: [], errors: [{ reason: 'export_missing_from_or_to_column' }] };
  const rules = rows.map((cells, index) => {
    const matchType = format >= 0 && /regex/i.test(cells[format] || '') ? 'regex' : 'exact';
    return {
    schemaVersion: 1,
    ruleKey: `${provider}:export:${index + 1}`,
    provider,
    storage: { kind: 'export', name: fileRef },
    stableId: `export:${index + 1}`,
    enabled: true,
    disabledReason: null,
    matchType,
    // A pattern is kept verbatim; only exact paths are normalized to site-relative form.
    source: matchType === 'exact' ? leadingSlash(cells[from]) : cells[from],
    destination: cells[to] ? (matchType === 'exact' ? leadingSlash(cells[to]) : cells[to]) : null,
    statusCode: status >= 0 ? toStatus(cells[status]) : 301,
    priority: null,
    conditions: [],
    language: null,
    extractedAt,
    };
  });
  return { rules, errors: [] };
}

// input: {
//   plugins: [{ slug, active }],             detected plugins (from wp-plugin-inventory)
//   physicalTables: [name],                  bridge table listing; null when no bridge
//   tablePrefix: string|null,                prefix reported by supported discovery, if any
//   tables: { <bare>: { rows, complete, error } },   bridge reads by bare table name
//   exports: { <provider>: { text, fileRef } },      operator-supplied exports
//   serverRulesSuspected: [{ provider, evidence }],  server/CDN rule stores seen elsewhere
// }
function extractRedirectSources(input) {
  const extractedAt = input.extractedAt || new Date().toISOString();
  const plugins = input.plugins || [];
  const coverage = [];
  const rules = [];
  const bySlug = new Map(plugins.map((p) => [p.slug, p]));
  for (const [provider, def] of Object.entries(PROVIDERS)) {
    const plugin = def.pluginSlugs.map((slug) => bySlug.get(slug)).find(Boolean);
    const supplied = input.exports && input.exports[provider];
    if (!plugin && !supplied) continue;
    const providerActive = Boolean(plugin ? plugin.active : true);
    if (supplied) {
      const result = normalizeExportCsv(provider, supplied.text, { extractedAt, fileRef: supplied.fileRef || 'operator-export' });
      rules.push(...result.rules.map((r) => (providerActive ? r : { ...r, enabled: false, disabledReason: 'provider_inactive' })));
      coverage.push({ provider, status: result.errors.length ? 'unreadable' : (result.rules.length ? 'extracted' : 'confirmed_empty'), channel: 'export', reason: result.errors[0]?.reason || null, ruleCount: result.rules.length, providerActive });
      continue;
    }
    if (def.storedIn === 'options') {
      coverage.push({ provider, status: 'unsupported', channel: 'none', reason: 'rules_stored_in_options_table; supply the plugin redirect export (CSV)', ruleCount: 0, providerActive });
      continue;
    }
    if (!input.physicalTables) {
      coverage.push({ provider, status: 'unreadable', channel: 'none', reason: 'no_structure_bridge; supply a redirect export', ruleCount: 0, providerActive });
      continue;
    }
    const resolved = resolveTable(def.ruleTable, input.physicalTables, { prefix: input.tablePrefix ?? null });
    if (!resolved.ok) {
      coverage.push({ provider, status: 'unreadable', channel: 'structure-bridge', reason: resolved.reason, ruleCount: 0, providerActive });
      continue;
    }
    const read = (input.tables || {})[def.ruleTable];
    if (!read || read.error || read.complete !== true || !Array.isArray(read.rows)) {
      coverage.push({ provider, status: 'unreadable', channel: 'structure-bridge', reason: read?.error || (read ? 'partial_read' : 'not_read'), ruleCount: 0, providerActive, physicalTable: resolved.physicalTable });
      continue;
    }
    let normalized;
    let errors = [];
    if (provider === 'redirection') {
      const groupsRead = (input.tables || {}).redirection_groups;
      if (read.rows.length && (!groupsRead || groupsRead.complete !== true)) {
        coverage.push({ provider, status: 'unreadable', channel: 'structure-bridge', reason: 'groups_not_read', ruleCount: 0, providerActive, physicalTable: resolved.physicalTable });
        continue;
      }
      normalized = normalizeRedirectionRows(read.rows, groupsRead ? groupsRead.rows : [], { providerActive, physicalTable: resolved.physicalTable, extractedAt });
    } else {
      const result = normalizeRankMathRows(read.rows, { providerActive, physicalTable: resolved.physicalTable, extractedAt });
      normalized = result.rules;
      errors = result.errors;
    }
    rules.push(...normalized);
    coverage.push({
      provider,
      status: errors.length ? 'unreadable' : (read.rows.length ? 'extracted' : 'confirmed_empty'),
      channel: 'structure-bridge',
      reason: errors.length ? `${errors.length} unparseable row(s)` : null,
      ruleCount: normalized.length,
      providerActive,
      physicalTable: resolved.physicalTable,
    });
  }
  for (const server of input.serverRulesSuspected || []) {
    coverage.push({ provider: server.provider, status: 'unsupported', channel: 'none', reason: `server/CDN rules outside WordPress (${server.evidence}); request an export from the host`, ruleCount: 0, providerActive: true });
  }
  for (const rule of rules) {
    const capability = input.targetCapabilities?.[rule.ruleKey];
    if (!capability) continue;
    if (typeof capability !== 'object' || Array.isArray(capability) ||
      typeof capability.productSupported !== 'boolean' ||
      (capability.automationSupported !== undefined && typeof capability.automationSupported !== 'boolean') ||
      typeof capability.evidence !== 'string' || !capability.evidence.trim()) {
      throw new Error(`targetCapabilities for ${rule.ruleKey} requires supported flags and evidence`);
    }
    rule.capability = capability;
  }
  return { rules, coverage: { schemaVersion: 1, generatedAt: extractedAt, providers: coverage } };
}

module.exports = {
  PROVIDERS,
  resolveTable,
  phpUnserialize,
  normalizeRedirectionRows,
  normalizeRankMathRows,
  normalizeExportCsv,
  extractRedirectSources,
};
