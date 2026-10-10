#!/usr/bin/env node
// Answers "which SDK call reads or writes this entity" for every entity in one
// call, from the Wix SDK packages installed in the current project.
//
//   node sdk-lookup.cjs contacts orders [--intent search|read|write|event|all] [--json]
//
// Per entity it prints the namespace to use and why, the import, the methods
// for the intent with their call shape, permission and required fields, the
// entity type's declaration (file:line) for checking fields, and any curated
// rule from sdk-curated.json.
//
// Each @wix/auto_sdk_* package is one record, derived from the package's .d.ts
// files: the JSDoc tags (@fqn, @permissionId, @permissionScopeId, ...), the
// public call signatures and the search and query specs, which every
// generated package carries.
//
// Exit codes: 0 every entity found · 1 an entity matched nothing (near matches
// printed) · 3 an entity's package is not installed (install command printed)
// · 2 usage.
const fs = require('fs');
const path = require('path');

const INTENTS = {
  search: ['search', 'query-builder', 'query', 'list'],
  read: ['query-builder', 'query', 'search', 'list', 'get', 'count'],
  write: ['create', 'update', 'upsert', 'delete', 'bulk'],
  event: [],
  all: null,
};

// --- package resolution ------------------------------------------------------

function activatePnp(from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const pnp = path.join(dir, '.pnp.cjs');
    if (fs.existsSync(pnp)) {
      try {
        require(pnp).setup();
      } catch {
        // Not fatal: node_modules resolution below may still work.
      }
      return;
    }
    if (path.dirname(dir) === dir) return;
  }
}

function resolveDir(name, from) {
  try {
    return path.dirname(require.resolve(`${name}/package.json`, { paths: [from] }));
  } catch {
    for (let dir = from; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', ...name.split('/'));
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
      if (path.dirname(dir) === dir) return null;
    }
  }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
// contacts-v-5 → contactsV5, order-transactions → orderTransactions
const camel = (s) => s.replace(/-v-(\d+)$/, 'V$1').replace(/-(\w)/g, (_, c) => c.toUpperCase());
const isAuto = (name) => name.startsWith('@wix/auto_sdk_');

function wixDirsAbove(from) {
  const out = [];
  for (let dir = from; ; dir = path.dirname(dir)) {
    const wix = path.join(dir, 'node_modules', '@wix');
    if (fs.existsSync(wix)) out.push(wix);
    if (path.dirname(dir) === dir) return out;
  }
}

// Finds every public SDK package (one that depends on @wix/auto_sdk_*
// packages) and every auto package, with the namespace each is exported as.
function findPackages(project) {
  const wrappers = new Map(); // name -> dir
  const consider = (name, from) => {
    if (wrappers.has(name) || isAuto(name) || !name.startsWith('@wix/')) return;
    const dir = resolveDir(name, from);
    if (!dir) return;
    const deps = Object.keys(readJson(path.join(dir, 'package.json')).dependencies ?? {});
    if (deps.some(isAuto)) wrappers.set(name, dir);
  };
  const pj = path.join(project, 'package.json');
  if (fs.existsSync(pj)) {
    const { dependencies = {}, devDependencies = {} } = readJson(pj);
    for (const name of Object.keys({ ...dependencies, ...devDependencies })) consider(name, project);
  }
  for (const wix of wixDirsAbove(project)) {
    for (const d of fs.readdirSync(wix)) consider(`@wix/${d}`, project);
  }

  const autos = new Map(); // name -> { dir, exportedAs: [] }
  for (const [wrapper, dir] of wrappers) {
    const deps = Object.keys(readJson(path.join(dir, 'package.json')).dependencies ?? {});
    const barrel = ['build/cjs/index.d.ts', 'build/es/index.d.mts']
      .map((f) => path.join(dir, f))
      .find((f) => fs.existsSync(f));
    const src = barrel ? fs.readFileSync(barrel, 'utf8') : '';
    for (const dep of deps.filter(isAuto)) {
      const depDir = resolveDir(dep, dir);
      if (!depDir) continue;
      const entry = autos.get(dep) ?? { dir: depDir, exportedAs: [] };
      const m = src.match(new RegExp(`import \\* as (\\w+) from '${dep}';\\s*export \\{ \\1 as (\\w+) \\}`));
      if (m) entry.exportedAs.push({ from: wrapper, namespace: m[2] });
      autos.set(dep, entry);
    }
  }
  // An auto package on disk that no installed wrapper re-exports is either a
  // dependency of another package (its own wrapper is not installed: name it
  // and the install command) or an SPI/internal package of an installed
  // wrapper (not importable from the wrapper's root).
  for (const wix of wixDirsAbove(project)) {
    for (const d of fs.readdirSync(wix).filter((d) => d.startsWith('auto_sdk_'))) {
      const name = `@wix/${d}`;
      if (!autos.has(name)) autos.set(name, { dir: path.join(wix, d), exportedAs: [] });
    }
  }
  for (const [name, entry] of autos) {
    if (entry.exportedAs.length) continue;
    const [, vertical, ns] = name.match(/^@wix\/auto_sdk_([^_]+)_(.+)$/) ?? [];
    const wrapper = vertical ? `@wix/${vertical}` : null;
    if (wrapper && !wrappers.has(wrapper)) {
      entry.exportedAs.push({ from: wrapper, namespace: camel(ns), installed: false });
    }
  }
  return { wrappers, autos };
}

// --- deriving a record from .d.ts --------------------------------------------

// Reads one `declare function name(...): Ret;` starting at `at`, balancing
// brackets so callback parameters and generic return types stay whole.
function readDeclaration(src, at) {
  let depth = 0;
  let i = src.indexOf('(', at);
  const paramsStart = i + 1;
  let paramsEnd = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '<' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '>' || c === '}' || c === ']') {
      if (src[i - 1] === '=' && c === '>') continue; // arrow
      depth--;
      if (depth === 0 && paramsEnd < 0 && c === ')') {
        paramsEnd = i;
        if (src[i + 1] !== ':') break;
      }
    } else if (c === ';' && depth === 0 && paramsEnd >= 0) break;
  }
  const params = src.slice(paramsStart, paramsEnd);
  const ret = src.slice(paramsEnd + 1, i).replace(/^:\s*/, '').trim();
  return { params, ret, end: i };
}

const tags = (doc, tag) =>
  [...doc.matchAll(new RegExp(`@${tag}(?:\\s+([^\\n*]*))?`, 'g'))].map((m) => (m[1] ?? '').trim());

function kindOf(name, params, ret) {
  if (/^on[A-Z]/.test(name)) return 'event';
  if (/^search/.test(name)) return 'search';
  if (/^query/.test(name)) {
    if (/QueryBuilder/.test(ret)) return 'query-builder';
    return /^\s*(query|options)\??:/.test(params) || /Query\b/.test(params) ? 'query' : 'other';
  }
  for (const k of ['list', 'get', 'count', 'create', 'update', 'upsert', 'bulk']) {
    if (name.startsWith(k)) return k;
  }
  if (/^(delete|remove)/.test(name)) return 'delete';
  return 'other';
}

// Drops the noise the generator puts in signatures, so a line stays readable.
function shorten(type, max = 90) {
  let t = type
    .replace(/NonNullablePaths<\s*([\w.]+)\s*,[^>]*?,\s*\d+\s*>/g, '$1')
    .replace(/\s+&\s+\{[\s\S]*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const open = (t.match(/</g) ?? []).length - (t.match(/>/g) ?? []).length;
  if (open > 0) t += '>'.repeat(open);
  if (t.length > max) t = `${t.slice(0, max - 1)}…`;
  return t;
}

function requiredOf(params) {
  const out = new Set();
  for (const m of params.matchAll(/NonNullablePaths<\s*[\w.]+\s*,([^>]*?),\s*\d+\s*>/g)) {
    for (const f of m[1].matchAll(/`([^`]+)`/g)) out.add(f[1]);
  }
  for (const m of params.matchAll(/(?:^|,)\s*(revision)\s*:/g)) out.add(m[1]);
  return [...out];
}

function paramList(params) {
  return splitParams(params).map((p) => {
    const m = p.match(/^(\w+\??)\s*:\s*([\s\S]*)$/);
    return m ? `${m[1]}: ${shorten(m[2], 40)}` : shorten(p, 40);
  });
}

// Splits a parameter list on its top-level commas.
function splitParams(params) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of params) {
    if ('(<{['.includes(c)) depth++;
    if (')>}]'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((p) => p.trim()).filter(Boolean);
}

const pascal = (s) => s.replace(/(^|[_-])(\w)/g, (_, __, c) => c.toUpperCase());

// The body of `interface Name {…}` or `type Name = {…}`, skipping an empty `{}`.
function typeBody(sources, name) {
  const re = new RegExp(`^(?:interface ${name}\\b[^{\\n]*|type ${name}\\s*=\\s*)\\{`, 'gm');
  for (const src of sources) {
    for (const m of src.matchAll(re)) {
      let depth = 0;
      let i = m.index + m[0].length - 1;
      for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) break;
      }
      const body = src.slice(m.index + m[0].length, i);
      if (body.trim()) return body;
    }
  }
  return null;
}

// Top-level members of a type body: [{ name, type }], comments dropped.
function membersOf(body) {
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\$\{[^}]*\}/g, '');
  const out = [];
  let depth = 0;
  for (const line of clean.split('\n')) {
    const m = depth === 0 && line.match(/^\s*(\w+)\??\s*:\s*(.*)$/);
    if (m) out.push({ name: m[1], type: m[2] });
    else if (out.length && depth > 0) out[out.length - 1].type += `\n${line}`;
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return out;
}

// `{ a, b: { c, d }, e: [{ f }] }`: the keys of a type, two levels deep.
// Named types are followed, except the entity type (its fields are in `type`).
function typeShape(sources, name, skip, depth = 0) {
  const body = typeBody(sources, name);
  return body ? shapeOfBody(sources, body, skip, depth) : null;
}

function shapeOfBody(sources, body, skip, depth) {
  const keys = membersOf(body).map(({ name, type }) => {
    if (depth >= 2) return name;
    const t = type.trim();
    const list = /\[\]\s*;?\s*$/.test(t) || /^Array</.test(t);
    let inner = null;
    if (t.startsWith('{')) inner = shapeOfBody(sources, t.slice(1, t.lastIndexOf('}')), skip, depth + 1);
    else {
      const ref = t.match(/^(?:Array<)?(\w+)/)?.[1];
      if (ref && !skip.has(ref) && /^[A-Z]/.test(ref)) inner = typeShape(sources, ref, skip, depth + 1);
    }
    if (!inner) {
      const ref = t.match(/^(\w+)(\[\])?/);
      return ref && skip.has(ref[1]) ? `${name}: ${ref[1]}${ref[2] ?? ''}` : name;
    }
    return `${name}: ${list ? `[${inner}]` : inner}`;
  });
  if (!keys.length) return null;
  return `{ ${keys.length > 8 ? [...keys.slice(0, 8), '…'].join(', ') : keys.join(', ')} }`;
}

function deriveRecord(name, dir) {
  const pj = readJson(path.join(dir, 'package.json'));
  const dep = pj.wix?.sdkDependency ?? {};
  const cjs = path.join(dir, 'build', 'cjs');
  const files = fs.existsSync(cjs)
    ? fs.readdirSync(cjs).filter((f) => f.endsWith('.d.ts') && f !== 'meta.d.ts')
    : [];
  const methods = new Map();
  const rawParams = new Map(); // name -> the declaration's full parameter text
  const events = [];
  let preview = 0;
  let typeAt = null;
  const entityType = dep.fqdn ? pascal(dep.fqdn.split('.').pop()) : null;
  const sources = [];

  for (const f of files) {
    const file = path.join(cjs, f);
    const src = fs.readFileSync(file, 'utf8');
    sources.push(src);
    if (entityType && !typeAt) {
      const m = new RegExp(`^interface ${entityType}\\b`, 'm').exec(src);
      if (m) typeAt = { name: entityType, file, line: src.slice(0, m.index).split('\n').length };
    }
    const re = /\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*declare function (\w+?)(?:\$\d+)?\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      const [, doc, fn] = m;
      const { params, ret } = readDeclaration(src, m.index + m[0].length - 1);
      if (/^\s*httpClient\s*:/.test(params)) continue; // the client-bound wrapper
      if (/@hidden\b|@internal\b/.test(doc)) continue;
      const kind = kindOf(fn, params, ret);
      if (kind === 'event') {
        if (!events.some((e) => e.name === fn)) {
          events.push({ name: fn, scopes: [...new Set(tags(doc, 'permissionScopeId'))] });
        }
        continue;
      }
      const maturity = tags(doc, 'documentationMaturity')[0];
      if (maturity === 'preview') preview++;
      const prev = methods.get(fn);
      const record = {
        name: fn,
        kind,
        fqn: tags(doc, 'fqn')[0] ?? prev?.fqn,
        params: paramList(params),
        returns: shorten(ret),
        permission: tags(doc, 'permissionId')[0] ?? prev?.permission,
        // Only events carry @permissionScopeId today; methods get it if the SDK adds it.
        scopes: [...new Set([...(prev?.scopes ?? []), ...tags(doc, 'permissionScopeId')])],
        identities: [...new Set([...(prev?.identities ?? []), ...tags(doc, 'applicableIdentity')])],
        admin: /@adminMethod\b/.test(doc) || !!prev?.admin,
        required: [...new Set([...(prev?.required ?? []), ...requiredOf(params)])],
        maturity: maturity ? maturity.toUpperCase() : prev?.maturity ?? 'GA',
        deprecated: /@deprecated\b/.test(doc)
          ? { replacedBy: tags(doc, 'replacedBy')[0] ?? null, removal: tags(doc, 'targetRemovalDate')[0] ?? null }
          : prev?.deprecated ?? null,
      };
      // Overloads: keep the richer signature (a query builder beats `other`).
      if (!prev || (prev.kind === 'other' && kind !== 'other')) {
        methods.set(fn, record);
        rawParams.set(fn, params);
      } else methods.set(fn, { ...prev, ...Object.fromEntries(Object.entries(record).filter(([, v]) => v != null)), kind: prev.kind, params: prev.params, returns: prev.returns });
    }
  }

  // The public call signature is `interface <Name>Signature { (params): Ret }`
  // in index.d.ts. The `declare function` in index.typings.d.ts is the REST
  // request shape (`search: CursorSearch` where the public call takes
  // `ContactSearch`, and `options` required where it is optional), so the
  // Signature wins whenever it exists.
  for (const meth of methods.values()) {
    const sig = `${meth.name[0].toUpperCase()}${meth.name.slice(1)}Signature`;
    for (const src of sources) {
      const m = new RegExp(`interface ${sig}\\s*\\{[\\s\\S]*?\\n\\s{4}\\(`).exec(src);
      if (!m) continue;
      const { params, ret } = readDeclaration(src, m.index + m[0].length - 1);
      meth.params = paramList(params);
      rawParams.set(meth.name, params);
      meth.returns = shorten(ret);
      meth.required = [...new Set([...meth.required, ...requiredOf(params)])];
      break;
    }
  }

  // <Entity>SearchSpec / <Entity>QuerySpec declare what a search or query
  // method accepts: the free-text fields and, per operator group, the fields
  // and sort. A closed list, shipped in every generated package that has one.
  const spec = (kind) => {
    const names = entityType ? [`${entityType}${kind}Spec`] : [];
    for (const src of sources) {
      const all = [...src.matchAll(new RegExp(`interface (\\w+)${kind}Spec extends ${kind}Spec\\b`, 'g'))].map((x) => `${x[1]}${kind}Spec`);
      const name = names.find((n) => all.includes(n)) ?? (all.length === 1 ? all[0] : null);
      if (name) {
        const fields = parseSpec(src, name);
        return fields && { entity: name.slice(0, -`${kind}Spec`.length), fields };
      }
    }
    return null;
  };
  const searchSpec = spec('Search');
  const querySpec = spec('Query');
  // The spec is one entity's (`V3ProductSearchSpec` → V3Product), so a query
  // or search returning another type in the same namespace
  // (services.queryPolicies) does not get it. A builder is generated per
  // entity, so it always does.
  const returnsEntity = (meth, entity) => {
    const body = typeBody(sources, meth.returns.match(/Promise<(\w+)/)?.[1] ?? '');
    const list = new RegExp(`^(?:Array<\\s*${entity}\\b|${entity}\\s*\\[\\])`);
    return !body || membersOf(body).some(({ type }) => list.test(type.trim()));
  };
  for (const meth of methods.values()) {
    const s = meth.kind === 'search' ? searchSpec : /^query/.test(meth.kind) ? querySpec : null;
    if (!s || (meth.kind !== 'query-builder' && !returnsEntity(meth, s.entity))) continue;
    if (Object.keys(s.fields).length) meth.filterable = s.fields;
    else meth.filterUnlisted = true;
  }

  const http = httpOf(path.join(cjs, 'meta.js'));
  for (const meth of methods.values()) if (http[meth.name]) meth.http = http[meth.name];

  // A search method takes free text only when its search object has a
  // `search` member (SearchDetails); some search methods take a filter only.
  for (const meth of methods.values()) {
    if (meth.kind !== 'search') continue;
    if (meth.filterable) {
      meth.freeText = Object.values(meth.filterable).some((f) => f.search);
      continue;
    }
    const type = meth.params[0]?.match(/:\s*(\w+)/)?.[1];
    for (const src of sources) {
      const m = new RegExp(`(?:interface ${type}\\b[^{]*|type ${type}\\s*=\\s*)\\{([\\s\\S]*?)\\n\\}`).exec(src);
      if (!m) continue;
      meth.freeText = /^\s{4}search\?\s*:/m.test(m[1]);
      break;
    }
  }

  // A query builder's own methods decide what one builder call can express:
  // the generated builders chain clauses with AND and most have no or().
  for (const meth of methods.values()) {
    if (meth.kind !== 'query-builder') continue;
    const builder = meth.returns.match(/(\w+QueryBuilder)/)?.[1];
    for (const src of sources) {
      const m = new RegExp(`interface ${builder}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(src);
      if (!m) continue;
      // Each member is `op: (propertyName: 'a' | 'b', value) => Builder`: the
      // literals are the closed list of fields that operator accepts.
      const ops = {};
      for (const line of m[1].split('\n')) {
        const mm = line.match(/^\s{4}(\w+)\s*:\s*\(/);
        if (!mm) continue;
        const params = line.slice(0, line.lastIndexOf('=>'));
        const fields = [...params.matchAll(/'([^']+)'/g)].map((x) => x[1]);
        ops[mm[1]] = /propertyNames?\s*:\s*string/.test(params) ? ['*'] : fields;
      }
      meth.builder = ops;
      break;
    }
    // Most builders also take one query object — `queryX({ filter, sort,
    // cursorPaging })` — declared as the @hidden `typedQueryX`. Its filter is
    // a WQL object, so it has $or where the builder has no or().
    const typed = `typed${meth.name[0].toUpperCase()}${meth.name.slice(1)}`;
    for (const src of sources) {
      const m = new RegExp(`declare function ${typed}\\s*\\(`).exec(src);
      if (!m) continue;
      const { params, ret } = readDeclaration(src, m.index + m[0].length - 1);
      const form = { params: paramList(params), returns: shorten(ret) };
      const skip = new Set([entityType]);
      const arg = params.match(/^\s*(\w+)\??\s*:\s*([A-Z]\w*)/);
      const argShape = arg && typeShape(sources, arg[2], skip);
      if (argShape) form.arg = `${arg[1]}: ${argShape}`;
      const retType = form.returns.match(/Promise<(\w+)/)?.[1];
      const result = retType && typeShape(sources, retType, skip);
      if (result) form.result = result;
      // `cursorPaging` or `paging`, depending on the method.
      form.keys = membersOf(typeBody(sources, arg?.[2] ?? '') ?? '').map((x) => x.name);
      meth.queryForm = form;
      break;
    }
  }

  // The keys of a search, query or list method's argument and response, so a
  // caller does not have to find `ContactSearch` (an empty `{}` placeholder in
  // index.typings.d.ts, the real `type ContactSearch = {` elsewhere).
  for (const meth of methods.values()) {
    if (!['search', 'query', 'list'].includes(meth.kind)) continue;
    const skip = new Set([entityType]);
    // The first parameter with an object type (`contactId: string` has no keys).
    for (const p of splitParams(rawParams.get(meth.name) ?? '')) {
      const m = p.match(/^(\w+)\??\s*:\s*(?:NonNullablePaths<\s*)?([A-Z]\w*)/);
      const shape = m && typeShape(sources, m[2], skip);
      if (shape) {
        meth.arg = `${m[1]}: ${shape}`;
        break;
      }
    }
    const retType = meth.returns.match(/Promise<(\w+)/)?.[1];
    if (retType) meth.result = typeShape(sources, retType, skip);
  }

  return {
    package: name,
    version: pj.version,
    fqdn: dep.fqdn ?? null,
    fqdnNamespace: dep.fqdnNamespace ?? null,
    maturity: methods.size && preview === methods.size ? 'PREVIEW' : 'GA',
    methods: [...methods.values()],
    events,
    type: typeAt,
  };
}

// interface XSearchSpec extends SearchSpec {
//   searchable: ['a', 'b'];
//   wql: [{ operators: ['$eq', …]; fields: ['c', …]; sort: 'BOTH' | 'ASC' | 'DESC' | 'NONE' }, …];
// } → { field: { ops: [...], sort: bool, search: bool } }
function parseSpec(src, name) {
  const m = new RegExp(`interface ${name} extends \\w+Spec\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src);
  if (!m) return null;
  const body = m[1];
  const list = (s) => [...(s ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const out = {};
  const field = (f) => (out[f] ??= { ops: [], sort: false, search: false });
  for (const f of list(body.match(/searchable:\s*\[([\s\S]*?)\]/)?.[1])) field(f).search = true;
  const wql = body.slice(body.indexOf('wql:'));
  for (const block of wql.matchAll(/\{([^{}]*)\}/g)) {
    const ops = list(block[1].match(/operators:\s*(\[[^\]]*\]|'[^']*')/)?.[1]);
    const sort = block[1].match(/sort:\s*'(\w+)'/)?.[1] ?? 'NONE';
    for (const f of list(block[1].match(/fields:\s*\[([^\]]*)\]/)?.[1])) {
      const e = field(f);
      e.ops = [...new Set([...e.ops, ...ops])];
      e.sort = e.sort || sort !== 'NONE';
    }
  }
  // `{}` when the spec is declared but lists no field (`wql: []`): the
  // filter fields are on the method's docs page only.
  return out;
}

function httpOf(metaFile) {
  if (!fs.existsSync(metaFile)) return {};
  const src = fs.readFileSync(metaFile, 'utf8');
  const out = {};
  const re = /function (\w+?)2\(\) \{[\s\S]*?httpMethod: "(\w+)",\s*path: "([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) out[m[1]] = `${m[2]} ${m[3]}`;
  return out;
}


// --- matching and ranking ----------------------------------------------------

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function variants(term) {
  const t = norm(term);
  const out = new Set([t, `${t}s`]);
  if (t.endsWith('ies')) out.add(`${t.slice(0, -3)}y`);
  if (t.endsWith('s')) out.add(t.slice(0, -1));
  return out;
}
const versionOf = (fqdn) => Number((fqdn ?? '').match(/\.v(\d+)\./)?.[1] ?? 0);
const baseOf = (ns) => norm(ns.replace(/V\d+$/, ''));

function namespacesOf(name, entry) {
  if (entry.exportedAs.length) return entry.exportedAs;
  return [{ from: name, namespace: null }];
}

function loadCurated() {
  const file = path.join(__dirname, 'sdk-curated.json');
  return fs.existsSync(file) ? readJson(file).rules : [];
}

function moduleMapRow(term) {
  const file = path.join(__dirname, '..', 'references', 'SDK_MODULE_MAP.md');
  if (!fs.existsSync(file)) return null;
  const v = variants(term);
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*`(@wix\/[\w-]+)`/);
    if (!m) continue;
    const words = m[1].split(/[\s/,]+/).map(norm);
    if (words.some((w) => v.has(w))) return { entities: m[1], package: m[2] };
  }
  return null;
}

function lookup(term, intent, pkgs, curated) {
  const v = variants(term);
  const primary = [];
  const related = [];
  for (const [name, entry] of pkgs.autos) {
    const pj = readJson(path.join(entry.dir, 'package.json'));
    const dep = pj.wix?.sdkDependency ?? {};
    const last = norm((dep.fqdn ?? '').split('.').pop() ?? '');
    for (const ns of namespacesOf(name, entry)) {
      const nsBase = ns.namespace ? baseOf(ns.namespace) : norm(name.replace(/^@wix\/auto_sdk_[^_]+_/, ''));
      const hay = norm(`${name} ${dep.fqdn ?? ''} ${ns.namespace ?? ''}`);
      if (v.has(nsBase) || v.has(last)) primary.push({ name, entry, ns });
      else if ([...v].some((x) => x.length > 3 && hay.includes(x))) related.push({ name, entry, ns });
    }
  }

  const rules = curated.filter((r) => r.entities.some((e) => v.has(norm(e))));
  // A curated preference can name a namespace the term itself does not match
  // (a refunds table reads orders), so pull that namespace in.
  const prefer = rules.find((r) => r.choice?.prefer && (!r.choice.intents || r.choice.intents.includes(intent)));
  const siteRule = rules.find((r) => r.choice === 'site');
  const pullIn = [prefer?.choice.prefer, ...(siteRule?.namespaces ?? [])].filter(Boolean);
  for (const want of pullIn) {
    if (primary.some((c) => c.ns.namespace === want)) continue;
    for (const [name, entry] of pkgs.autos) {
      const ns = entry.exportedAs.find((x) => x.namespace === want);
      if (ns) primary.push({ name, entry, ns });
    }
  }
  if (!primary.length) {
    const row = moduleMapRow(term);
    if (row && !pkgs.wrappers.has(row.package)) return { term, status: 'not-installed', row, rules };
    return { term, status: 'unknown', near: nearMatches(term, pkgs), related: related.map(label), rules };
  }

  const candidates = primary.map((c) => ({ ...c, record: deriveRecord(c.name, c.entry.dir) }));
  const reasons = new Map();
  const why = (c, r) => reasons.set(c, [...(reasons.get(c) ?? []), r]);
  for (const c of candidates) {
    why(c, `fqdn v${versionOf(c.record.fqdn)} (${c.record.fqdn})`);
    if (c.record.maturity === 'PREVIEW') why(c, 'preview');
    if (c.record.methods.length && c.record.methods.every((m) => m.deprecated)) why(c, 'deprecated');
    if (intent === 'search') why(c, c.record.methods.some((m) => m.kind === 'search') ? 'has search' : 'no search method');
    if (!c.ns.namespace) why(c, 'not exported from a public package root (SPI or internal)');
    if (c.ns.installed === false) why(c, `${c.ns.from} not installed`);
  }

  const preferRule = prefer && candidates.some((c) => c.ns.namespace === prefer.choice.prefer) ? prefer : null;
  const score = (c) => [
    c.record.maturity === 'PREVIEW' || reasons.get(c).includes('deprecated') ? 0 : 1,
    preferRule && c.ns.namespace === preferRule.choice.prefer ? 1 : 0,
    c.ns.namespace ? 1 : 0,
    intent === 'search' && c.record.methods.some((m) => m.kind === 'search') ? 1 : 0,
    versionOf(c.record.fqdn),
  ];
  candidates.sort((a, b) => {
    const [x, y] = [score(a), score(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
    return (a.ns.namespace ?? '').localeCompare(b.ns.namespace ?? '');
  });
  if (preferRule) why(candidates[0], 'curated');
  return {
    term,
    status: 'found',
    siteDependent: !!siteRule,
    candidates: candidates.map((c) => ({
      ...c,
      reasons: reasons.get(c),
      site: !!siteRule && siteRule.namespaces.includes(c.ns.namespace),
    })),
    related: related.filter((r) => !primary.some((p) => p.name === r.name)).map(label),
    rules,
  };
}

const label = (c) => (c.ns.namespace ? `${c.ns.namespace} (${c.ns.from})` : c.name);

// The call-shape rule: which one call to write for the intent, and why.
//   search: a search method with free text → one call, the term in
//           search.search.expression. Otherwise one filter object with $or,
//           one clause per field. A query builder chains clauses with AND and
//           has no or(): when the method also takes a query object, its
//           filter has $or; else one field with startsWith, never one query
//           per field merged in the client.
//   read:   the builder for filters, sort and paging, on the fields its
//           operators list (a closed list), else the filter object. A
//           builder with no filter or sort (extendedBookings) → the query
//           object.
//   write:  a method that requires revision → read the entity first.
function shapeFor(record, ns, intent) {
  const by = (k) => record.methods.filter((m) => m.kind === k && !m.deprecated);
  const [search] = by('search');
  const [builder] = by('query-builder');
  const [query] = by('query').filter((m) => m.name.toLowerCase().includes(baseOf(ns ?? '')));
  const call = (m) => `${ns ?? 'sdk'}.${m.name}`;
  const textFields = (m) =>
    m?.filterable ? Object.entries(m.filterable).filter(([, f]) => f.search).map(([k]) => k) : null;
  const builderFields = (op) => builder?.builder?.[op] ?? null;
  const queryCall = (m) => `${call(m)}({ ${(m.queryForm.keys?.length ? m.queryForm.keys : ['filter', 'sort']).join(', ')} })`;
  const out = [];

  if (intent === 'search') {
    if (search && search.freeText !== false) {
      const fields = textFields(search);
      out.push(`${call(search)}({ search: { expression: term } }): one call${fields ? `; the term matches ${fields.join(', ')}` : ''}; exact-match facets go in filter`);
    } else if (search || query) {
      const m = search ?? query;
      out.push(`${call(m)}: no free text; one filter object with $or, one clause per field the term may match (operators from its filter list)`);
    } else if (builder?.builder?.or) {
      out.push(`${call(builder)}(): no search method; the builder has or(), so chain one .startsWith() per field inside .or()`);
    } else if (builder?.queryForm) {
      out.push(`${queryCall(builder)}: no search method, and the builder has no or(): pass one query object instead`);
      out.push(`  its filter is WQL: $or with one clause per field the term may match (operators from ${builder.filterable ? 'its filter list' : 'its docs page'})`);
      out.push('  an API may implement only part of WQL: if its docs page rules out $or, use ONE field and say so to the user');
      out.push('  never run one query per field and merge the results in the client');
    } else if (builder) {
      const sw = builderFields('startsWith');
      out.push(`${call(builder)}(): no search method, and the builder chains clauses with AND and has no or()`);
      out.push(`  so one builder call cannot match a term in any of several fields: use startsWith on ONE field${sw?.length ? ` (${sw.join(', ')})` : ''}, and say so to the user`);
      out.push('  never run one query per field and merge the results in the client');
    }
  } else if (intent === 'read') {
    if (builder) {
      const ops = Object.entries(builder.builder ?? {}).filter(([k, f]) => f.length && !['limit', 'skip', 'skipTo', 'find'].includes(k));
      if (!ops.length && builder.queryForm) {
        out.push(`${queryCall(builder)}: the builder has no filter or sort, so pass one query object`);
        out.push(`  fields and operators: ${builder.filterable ? 'its filter list' : 'its docs page (the package does not list them)'}`);
      } else {
        out.push(`${call(builder)}(): filters, sort and paging chained on the builder (AND only); fields per operator are a closed list:`);
        for (const [op, f] of ops) out.push(`  .${op}(${f.includes('*') ? 'any field' : capped(f, 10)})`);
        if (builder.queryForm) out.push(`  or one query object, ${queryCall(builder)}, whose filter also takes $or`);
      }
      if (search) out.push(`  a search box over several fields → ${call(search)} instead (--intent search)`);
    } else if (search || query) {
      out.push(`${call(search ?? query)}: one filter object (fields from its filter list or its docs page)`);
    }
  } else if (intent === 'write') {
    const needsRevision = record.methods.filter((m) => /^(update|delete)/.test(m.kind) && m.required.some((r) => /revision$/.test(r)));
    if (needsRevision.length) {
      out.push(`${needsRevision.map(call).join(', ')} require revision: read the entity first and pass its current revision (a stale one fails)`);
    }
  }
  return out;
}

function nearMatches(term, pkgs) {
  const t = norm(term);
  const names = new Set();
  for (const [name, entry] of pkgs.autos) for (const ns of namespacesOf(name, entry)) names.add(ns.namespace ?? name);
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  return [...names]
    .map((n) => [n, norm(n).includes(t) || t.includes(baseOf(n)) ? 0 : dist(t, baseOf(n))])
    .filter(([, d]) => d <= 3)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 5)
    .map(([n]) => n);
}

// --- output ------------------------------------------------------------------

// filterable: { field: { ops: [...], sort: bool, search: bool } } — a closed
// list per method, so a field that is not here cannot be filtered on.
function renderFilterable(filterable) {
  const rows = Object.entries(filterable);
  const text = rows.filter(([, f]) => f.search).map(([k]) => k);
  const sort = rows.filter(([, f]) => f.sort).map(([k]) => k);
  const byOps = new Map();
  for (const [k, f] of rows) {
    const ops = (f.ops ?? []).join(' ');
    // A free-text-only field (contacts' `name.full`) has no operators: the free-text line covers it.
    if (!ops) continue;
    byOps.set(ops, [...(byOps.get(ops) ?? []), k]);
  }
  const out = [];
  if (text.length) out.push(`free text: ${text.join(', ')}`);
  for (const [ops, fields] of byOps) out.push(`filter ${ops}: ${capped(fields, 12)}`);
  if (sort.length) out.push(`sort: ${capped(sort, 12)}`);
  out.push('(closed list: a field not shown cannot be filtered or sorted on)');
  return out;
}

const capped = (list, n = 8) => (list.length > n ? `${list.slice(0, n).join(', ')}, +${list.length - n} more` : list.join(', '));

function render(result, intent, project) {
  const out = [`== ${result.term}  (intent: ${intent})`];
  const rel = (f) => path.relative(project, f) || f;
  if (result.status === 'not-installed') {
    out.push(`not installed: "${result.row.entities}" → ${result.row.package}`);
    out.push(`  npm i ${result.row.package}   then run this lookup again`);
  } else if (result.status === 'unknown') {
    out.push('no installed SDK namespace matches this name');
    if (result.near.length) out.push(`  near: ${result.near.join(', ')}`);
    if (result.related.length) out.push(`  related: ${capped(result.related)}`);
    out.push('  if it is a Wix business entity, check references/SDK_MODULE_MAP.md, then search the SDK docs');
  } else {
    // A site-dependent entity has one namespace per site kind, all shown in full.
    const chosen = result.siteDependent ? result.candidates.filter((c) => c.site) : result.candidates.slice(0, 1);
    const lead = result.siteDependent ? 'site' : 'use';
    for (const c of chosen) out.push(`${lead.padEnd(5)} ${label(c)} — ${c.reasons.join('; ')}`);
    for (const c of result.candidates.filter((c) => !chosen.includes(c))) {
      out.push(`also  ${label(c)} — ${c.reasons.join('; ')}`);
    }
    for (const c of chosen) out.push(...renderCandidate(c, intent, rel));
    if (result.related.length) out.push(`related: ${capped(result.related)}`);
  }
  for (const r of result.rules) out.push(`note  ${r.note}  [${r.source}]`);
  return out.join('\n');
}

function renderCandidate(c, intent, rel) {
  const r = c.record;
  const ns = c.ns.namespace;
  const out = [];
  if (!ns) out.push(`// ${c.name} is not exported from a public package root; check its wrapper's subpath exports`);
  else if (c.ns.installed === false) out.push(`// ${c.ns.from} is not installed (only pulled in by another package): npm i ${c.ns.from}`);
  out.push(ns ? `import { ${ns} } from '${c.ns.from}';` : `import * as sdk from '${c.name}';`);
  const shape = shapeFor(r, ns, intent);
  if (shape.length) out.push(`shape ${shape[0]}`, ...shape.slice(1).map((l) => `      ${l}`));
  const kinds = INTENTS[intent];
  const shown =
    intent === 'event'
      ? []
      : r.methods
          .filter((m) => !kinds || kinds.includes(m.kind))
          .sort((a, b) => (kinds ? kinds.indexOf(a.kind) - kinds.indexOf(b.kind) : 0));
  for (const m of shown) {
    const call = `${ns ?? 'sdk'}.${m.name}(${m.params.join(', ')}) → ${m.returns}`;
    out.push(`  ${m.kind.padEnd(13)} ${call}`);
    // @applicableIdentity is APP on visitor methods too (addLineItemsToCurrentCart,
    // getCurrentMember), so it says nothing about who may call: not printed.
    const facts = [`permission ${m.permission ?? '?'}`];
    facts.push(m.scopes?.length ? `scope ${m.scopes.join(' | ')}` : 'scope: not in the package (the method docs page lists it)');
    if (m.admin) facts.push('admin method');
    if (m.required.length) facts.push(`required ${m.required.join(', ')}`);
    if (m.maturity !== 'GA') facts.push(m.maturity.toLowerCase());
    if (m.deprecated) facts.push(`DEPRECATED${m.deprecated.replacedBy ? ` → ${m.deprecated.replacedBy}` : ''}`);
    out.push(`  ${''.padEnd(13)} ${facts.join(' · ')}`);
    if (m.arg) out.push(`  ${''.padEnd(13)} arg     ${m.arg}`);
    if (m.result) out.push(`  ${''.padEnd(13)} returns ${m.result}`);
    if (m.queryForm) {
      const q = m.queryForm;
      out.push(`  ${''.padEnd(13)} or      ${ns ?? 'sdk'}.${m.name}(${q.params.join(', ')}) → ${q.returns}`);
      if (q.arg) out.push(`  ${''.padEnd(13)} arg     ${q.arg}`);
      if (q.result) out.push(`  ${''.padEnd(13)} returns ${q.result}`);
    }
    if (m.filterable) out.push(...renderFilterable(m.filterable).map((l) => `  ${''.padEnd(13)} ${l}`));
    else if (m.filterUnlisted) out.push(`  ${''.padEnd(13)} filter fields: not in the package (the method docs page lists them)`);
    if (m.fqn) out.push(`  ${''.padEnd(13)} fqn ${m.fqn}`);
  }
  const others = r.methods.filter((m) => !shown.includes(m)).map((m) => m.name);
  if (others.length && intent !== 'all') {
    const next = intent === 'write' ? '--intent all' : '--intent write (or all)';
    out.push(`  other methods (params, permission, scope: run again with ${next}): ${others.join(', ')}`);
  }
  if (intent === 'event' || intent === 'all') {
    for (const e of r.events) out.push(`  event         ${ns ?? 'sdk'}.${e.name}(handler) · scope ${e.scopes.join(' | ') || '?'}`);
  } else if (r.events.length) {
    out.push(`  events: ${r.events.map((e) => e.name).join(', ')}`);
  }
  if (r.type) out.push(`  type ${r.type.name}  ${rel(r.type.file)}:${r.type.line}`);
  out.push(`  package ${r.package}@${r.version}`);
  return out;
}

// --- main --------------------------------------------------------------------

function main(argv) {
  const args = [...argv];
  const flag = (n) => {
    const i = args.indexOf(n);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const intent = flag('--intent') ?? 'read';
  const project = path.resolve(flag('--project') ?? process.cwd());
  const asJson = args.includes('--json');
  const terms = args.filter((a) => !a.startsWith('--'));
  if (!terms.length || !(intent in INTENTS)) {
    console.error('usage: sdk-lookup.cjs <entity> [<entity> ...] [--intent search|read|write|event|all] [--json]');
    return 2;
  }
  activatePnp(project);
  const pkgs = findPackages(project);
  if (!pkgs.autos.size) {
    console.error(`no @wix/auto_sdk_* packages found from ${project}; install the vertical's @wix/<package> first`);
    return 3;
  }
  const curated = loadCurated();
  const results = terms.map((t) => lookup(t, intent, pkgs, curated));
  if (asJson) {
    const plain = results.map((r) => ({
      ...r,
      candidates: r.candidates?.map((c) => ({
        namespace: c.ns.namespace,
        from: c.ns.from,
        reasons: c.reasons,
        site: c.site,
        shape: shapeFor(c.record, c.ns.namespace, intent),
        record: c.record,
      })),
    }));
    console.log(JSON.stringify(plain, null, 2));
  } else {
    console.log(results.map((r) => render(r, intent, project)).join('\n\n'));
  }
  const codes = results.map((r) => ({ found: 0, unknown: 1, 'not-installed': 3 })[r.status]);
  return Math.max(...codes);
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { findPackages, deriveRecord, lookup, loadCurated };
