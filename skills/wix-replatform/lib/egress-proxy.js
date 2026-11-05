'use strict';

// Requests through an HTTP proxy, with Node's core modules only.
//
// Why this exists: Node's built-in `fetch` and `https.request` ignore HTTPS_PROXY / HTTP_PROXY
// unless the process was started with NODE_USE_ENV_PROXY=1, and that variable does not exist
// before Node 22.21 (the product supports 22.12 and newer). Setting it from inside a running
// process has no effect. On a machine whose only route out is a proxy, every call would fail with
// a DNS error. This file opens the tunnel itself, so the telemetry sender and the Wix API calls
// work on every supported Node with nothing set at launch. Extra certificate authorities
// (NODE_EXTRA_CA_CERTS) apply as they do for any Node program, which a TLS-inspecting proxy needs.
//
// Secrets: the proxy URL may carry a password. It is read from the environment, used for the
// request, and never put in an error, a log line or a return value.

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const zlib = require('node:zlib');

// The hop to the proxy itself must go direct. A Node started with --use-env-proxy (or
// NODE_USE_ENV_PROXY=1) routes the global agent through the proxy, which would send our CONNECT to
// the proxy through the proxy. An explicit agent is never proxied.
// No Wix or telemetry answer is near this; a runaway body is cut off instead of held in memory.
const MAX_BODY_BYTES = 64 * 1024 * 1024;

const DIRECT_AGENTS = { 'http:': new http.Agent(), 'https:': new https.Agent() };

function envValue(env, ...names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

// `new URL(...).hostname` keeps the square brackets on IPv6 literals.
function bareHost(hostname) {
  return String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
}

// Every spelling of "this machine": the test mocks and local servers must never go to a proxy.
// `new URL` rewrites `::ffff:127.0.0.1` to `::ffff:7f00:1`, so the hex form is matched too.
function isLocalHost(hostname) {
  const host = bareHost(hostname);
  return host === 'localhost'
    || host === '0.0.0.0'
    || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    || host === '::1'
    || /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    || /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host);
}

function ipv4ToInt(address) {
  return address.split('.').reduce((total, part) => (total * 256) + Number(part), 0);
}

function inIpv4Range(address, base, bits) {
  if (bits < 0 || bits > 32) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(ipv4ToInt(address) / size) === Math.floor(ipv4ToInt(base) / size);
}

// NO_PROXY: comma or space separated. `*` excludes everything. An entry matches the host exactly
// or as a domain suffix (`example.com`, `.example.com` and `*.example.com` all match
// `a.example.com`). An optional `:port` must equal the target port. An IPv4 range (`10.0.0.0/8`)
// matches the addresses inside it; IPv6 ranges are not matched.
function excludedByNoProxy(target, env) {
  const list = envValue(env, 'NO_PROXY', 'no_proxy');
  if (!list) return false;
  const host = bareHost(target.hostname).replace(/\.$/, '');
  const port = target.port || (target.protocol === 'https:' ? '443' : '80');
  return list.split(/[\s,]+/).filter(Boolean).some((raw) => {
    const entry = raw.toLowerCase();
    if (entry === '*') return true;
    // An IPv4 range (10.0.0.0/8) excludes the IPv4 addresses inside it.
    const cidr = entry.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
    if (cidr) return net.isIPv4(host) && inIpv4Range(host, cidr[1], Number(cidr[2]));
    // `[::1]:8080` has a port; a bare IPv6 literal (`fe80::1`) has colons but no port.
    const bracket = entry.match(/^\[([^\]]+)\](?::(\d+))?$/);
    const parts = bracket ? [entry, bracket[1], bracket[2]] : (net.isIPv6(entry) ? [entry, entry, undefined] : entry.match(/^(.*?)(?::(\d+))?$/));
    let entryHost = parts[1].replace(/^\*\.?/, '').replace(/^\./, '').replace(/^\[|\]$/g, '').replace(/\.$/, '');
    // Compare IPv6 literals in the form `new URL` gives the target (compressed, lower case).
    if (net.isIPv6(entryHost)) { try { entryHost = bareHost(new URL(`http://[${entryHost}]`).hostname); } catch { /* keep as written */ } }
    if (!entryHost) return false;
    if (parts[2] && parts[2] !== port) return false;
    return host === entryHost || host.endsWith(`.${entryHost}`);
  });
}

// Node proxies `fetch` and `http(s).request` itself when started with NODE_USE_ENV_PROXY=1, but only
// from Node 22.21 and 24.0 (measured: 22.13 ignores it, 22.23 and 24 honor it). On an older Node the
// variable does nothing, so it must not stop us from using the tunnel.
function nodeProxiesFromEnv(version = process.versions.node) {
  const [major, minor] = String(version).split('.').map(Number);
  return major >= 24 || (major === 22 && minor >= 21);
}

// The proxy URL to use for `target`, or null when the request should go direct: Node is already
// proxying `fetch` itself, the target is local, no proxy variable applies, NO_PROXY excludes the
// host, or the proxy is not an http(s) proxy (a socks proxy is not supported; the call then goes
// direct, as before this file existed).
function proxyFor(target, env = process.env, nodeVersion = process.versions.node) {
  if (env.NODE_USE_ENV_PROXY === '1' && nodeProxiesFromEnv(nodeVersion)) return null;
  if (isLocalHost(target.hostname)) return null;
  const raw = target.protocol === 'https:'
    ? envValue(env, 'HTTPS_PROXY', 'https_proxy')
    : envValue(env, 'HTTP_PROXY', 'http_proxy');
  if (!raw) return null;
  if (excludedByNoProxy(target, env)) return null;
  try {
    const proxy = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return proxy.protocol === 'http:' || proxy.protocol === 'https:' ? proxy : null;
  } catch {
    return null;
  }
}

function proxyAuthHeaders(proxy) {
  if (!proxy.username && !proxy.password) return {};
  // A password with a bare `%` is not valid percent-encoding; use it as written rather than fail.
  const decode = (value) => { try { return decodeURIComponent(value); } catch { return value; } };
  const credentials = `${decode(proxy.username)}:${decode(proxy.password)}`;
  return { 'proxy-authorization': `Basic ${Buffer.from(credentials).toString('base64')}` };
}

// One request to `target` through `proxy`. `body` is a Buffer or null. Resolves with
// `{ status, statusText, headers, body }` (headers lower-cased, repeated headers as arrays, body a
// Buffer). Rejects with an error that has `code` (a Node error code) or `proxyStatus` (the proxy
// refused the tunnel). `signal` aborts everything. Never throws synchronously, and leaves no open
// handle after it settles.
function requestViaProxy(target, proxy, { method = 'GET', headers = {}, body = null, idleTimeoutMs = 0 } = {}, signal) {
  return new Promise((resolve, reject) => {
    const cleanups = [];
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      for (const cleanup of cleanups) {
        try { cleanup(); } catch { /* best effort */ }
      }
      fn(value);
    };
    const fail = (error) => finish(reject, error);

    // An idle limit, not a total one: a large upload or a slow answer that keeps moving is fine; a
    // connection that moves no bytes for `idleTimeoutMs` is not. `watched` is the socket whose byte
    // counters show the movement (the proxy connection, then the tunnel).
    let watched = null;
    let lastBytes = 0;
    let idleTimer = null;
    const armIdle = () => {
      if (!idleTimeoutMs) return;
      idleTimer = setTimeout(() => {
        const bytes = watched ? watched.bytesRead + watched.bytesWritten : 0;
        if (bytes !== lastBytes) { lastBytes = bytes; armIdle(); return; }
        fail(Object.assign(new Error('no activity before the deadline'), { code: 'ETIMEDOUT' }));
      }, idleTimeoutMs);
      idleTimer.unref();
    };
    cleanups.push(() => clearTimeout(idleTimer));
    armIdle();

    const onAbort = () => fail(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }));
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener('abort', onAbort));
    }

    const requestHeaders = { ...headers, connection: 'close' };
    if (body) requestHeaders['content-length'] = body.length;
    const readResponse = (res) => {
      const chunks = [];
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_BODY_BYTES) { fail(Object.assign(new Error('answer too large'), { code: 'ERR_BODY_TOO_LARGE' })); return; }
        chunks.push(chunk);
      });
      res.on('end', () => finish(resolve, {
        status: res.statusCode,
        statusText: res.statusMessage || '',
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
      res.on('error', fail);
      res.on('close', () => fail(Object.assign(new Error('closed'), { code: 'ECONNRESET' })));
    };
    const proxyHost = bareHost(proxy.hostname);
    const proxyPort = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80));
    const proxyTransport = proxy.protocol === 'https:' ? https : http;

    try {
      if (target.protocol !== 'https:') {
        // Plain http target: an absolute-URI request to the proxy.
        const request = proxyTransport.request({
          host: proxyHost,
          port: proxyPort,
          method,
          agent: DIRECT_AGENTS[proxy.protocol],
          path: `${target.origin}${target.pathname}${target.search}`,
          headers: { ...requestHeaders, host: target.host, ...proxyAuthHeaders(proxy) },
        }, readResponse);
        cleanups.push(() => request.destroy());
        request.on('error', fail);
        request.on('socket', (socket) => { watched = socket; });
        request.end(body);
        return;
      }

      const targetHost = bareHost(target.hostname);
      const targetPort = Number(target.port || 443);
      // A CONNECT authority writes an IPv6 literal in square brackets.
      const authority = `${net.isIPv6(targetHost) ? `[${targetHost}]` : targetHost}:${targetPort}`;
      const connectRequest = proxyTransport.request({
        host: proxyHost,
        port: proxyPort,
        method: 'CONNECT',
        agent: DIRECT_AGENTS[proxy.protocol],
        path: authority,
        headers: { host: authority, ...proxyAuthHeaders(proxy) },
      });
      cleanups.push(() => connectRequest.destroy());
      connectRequest.on('error', fail);
      connectRequest.on('socket', (socket) => { watched = socket; });
      connectRequest.on('connect', (res, socket) => {
        watched = socket;
        cleanups.push(() => socket.destroy());
        socket.on('error', fail);
        if (res.statusCode !== 200) {
          fail(Object.assign(new Error('proxy refused the tunnel'), { proxyStatus: res.statusCode }));
          return;
        }
        // This runs from an event, outside the try/catch around the setup: a synchronous throw from
        // https.request or tls.connect (a bad header or path) must reject the call, not crash.
        try {
          // `host` makes Node verify the certificate against the target (an IP literal included),
          // not against the proxy's name; `servername` is for SNI and is not allowed for an IP.
          const tlsOptions = { socket, host: targetHost };
          if (!net.isIP(targetHost)) tlsOptions.servername = targetHost;
          // No `agent` key on purpose: with an agent (even `agent: false`, which builds a fresh
          // one) Node ignores `createConnection` and dials the host directly, bypassing the tunnel.
          const request = https.request({
            host: targetHost,
            port: targetPort,
            method,
            path: `${target.pathname}${target.search}`,
            // The Host header as fetch writes it: the port only when it is not the default.
            headers: { host: target.host, ...requestHeaders },
            createConnection: () => tls.connect(tlsOptions),
          }, readResponse);
          cleanups.push(() => request.destroy());
          request.on('error', fail);
          request.end(body);
        } catch (error) {
          fail(error);
        }
      });
      connectRequest.end();
    } catch (error) {
      fail(error);
    }
  });
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 20;

// Node's own fetch gives up after about five minutes of silence from the server. The tunnel path
// has no such limit unless it is given one, and several callers pass no signal, so a proxy or
// server that goes quiet would hang a run forever. It is an idle limit (no bytes moved), as in
// Node, not a cap on the whole transfer.
const EGRESS_TIMEOUT_MS = 300000;

// Captured at load. A test (or an instrumentation library) that replaces `globalThis.fetch` expects
// to see the call; if it is replaced we hand the call to the replacement instead of opening our
// own connection, so a stub never turns into real traffic behind a proxy.
const nativeFetch = globalThis.fetch;

function refusal(message, code) {
  return Object.assign(new TypeError(message), { code });
}

// A drop-in for `fetch` that follows the environment's proxy. Same arguments; resolves to a
// standard Response. With no proxy it IS `globalThis.fetch`, read at call time. What it does not do:
// accept a body that is not a string, Buffer,
// typed array or ArrayBuffer, or take a Request as its first argument. Those are refused before
// anything is sent (so is a body on GET or HEAD, as in fetch). A call that moves no bytes for
// `timeoutMs` fails like fetch's own timeout. It sends no `Accept-Encoding`, because it does not decode.
function createEgressFetch({ timeoutMs = EGRESS_TIMEOUT_MS } = {}) {
  return async function egressFetch(input, init = {}) {
    if (globalThis.fetch !== nativeFetch) return globalThis.fetch(input, init);
    const isUrlInput = typeof input === 'string' || input instanceof URL;
    const target = isUrlInput ? new URL(input) : null;
    const proxy = target ? proxyFor(target) : null;
    if (target && !proxy) return globalThis.fetch(input, init);
    if (!target) {
      // A Request (or anything else) can only be handled by fetch itself; refuse when a proxy
      // would apply rather than silently going direct.
      let candidate = null;
      try { candidate = new URL(input && input.url); } catch { /* not a request */ }
      if (!candidate || !proxyFor(candidate)) return globalThis.fetch(input, init);
      throw refusal('egressFetch accepts a URL or a string as its first argument', 'EGRESS_UNSUPPORTED_INPUT');
    }

    let body = null;
    if (init.body !== undefined && init.body !== null) {
      if (typeof init.body === 'string') body = Buffer.from(init.body);
      else if (Buffer.isBuffer(init.body)) body = init.body;
      else if (ArrayBuffer.isView(init.body)) body = Buffer.from(init.body.buffer, init.body.byteOffset, init.body.byteLength);
      else if (init.body instanceof ArrayBuffer) body = Buffer.from(init.body);
      else throw refusal('egressFetch accepts a string, Buffer, typed array or ArrayBuffer body', 'EGRESS_UNSUPPORTED_BODY');
    }
    let method = String(init.method || 'GET').toUpperCase();
    if (body && (method === 'GET' || method === 'HEAD')) throw refusal('Request with GET/HEAD method cannot have body.', 'EGRESS_UNSUPPORTED_BODY');
    if (target.username || target.password) throw refusal('Request cannot be constructed from a URL that includes credentials', 'EGRESS_UNSUPPORTED_INPUT');
    let headers = {};
    for (const [name, value] of new Headers(init.headers || {})) headers[name] = value;
    // The answer is not decoded here, so never ask for a compressed one. The other defaults are the
    // ones Node's fetch sends, so a call looks the same on the wire with or without a proxy.
    delete headers['accept-encoding'];
    headers = { accept: '*/*', 'accept-language': '*', 'user-agent': 'node', ...headers };

    // Redirects follow fetch: `follow` (default) up to 20 hops, `manual` returns the 3xx, `error`
    // rejects. A 303, and a 301 or 302 after POST, becomes a GET without the body; 307 and 308 keep
    // the method and body; a hop to another origin drops credentials.
    const redirectMode = init.redirect || 'follow';
    let current = target;
    for (let hops = 0; ; hops += 1) {
      const currentProxy = hops === 0 ? proxy : proxyFor(current);
      if (!currentProxy) {
        // A hop to a host that goes direct (NO_PROXY, a local address) is finished by the real fetch.
        return globalThis.fetch(current, { ...init, method, headers, body: body || undefined });
      }
      let response;
      try {
        response = await requestViaProxy(current, currentProxy, { method, headers, body, idleTimeoutMs: timeoutMs }, init.signal);
      } catch (error) {
        if (error && error.code === 'ABORT_ERR') {
          throw (init.signal && init.signal.reason) || new DOMException('This operation was aborted', 'AbortError');
        }
        const cause = error && error.proxyStatus
          ? Object.assign(new Error('proxy refused the tunnel'), { code: `PROXY_CONNECT_${error.proxyStatus}`, proxyStatus: error.proxyStatus })
          : error;
        throw new TypeError('fetch failed', { cause });
      }
      const location = response.headers.location;
      if (REDIRECT_STATUS.has(response.status) && location && redirectMode !== 'manual') {
        if (redirectMode === 'error') {
          throw new TypeError('fetch failed', { cause: Object.assign(new Error('unexpected redirect'), { code: 'ERR_UNEXPECTED_REDIRECT' }) });
        }
        if (hops >= MAX_REDIRECTS) {
          throw new TypeError('fetch failed', { cause: Object.assign(new Error('too many redirects'), { code: 'ERR_TOO_MANY_REDIRECTS' }) });
        }
        let next;
        try { next = new URL(location, current); } catch { next = null; }
        if (!next || (next.protocol !== 'http:' && next.protocol !== 'https:')) {
          throw new TypeError('fetch failed', { cause: Object.assign(new Error('bad redirect target'), { code: 'ERR_INVALID_REDIRECT' }) });
        }
        const toGet = (response.status === 303 && method !== 'GET' && method !== 'HEAD')
          || ((response.status === 301 || response.status === 302) && method === 'POST');
        if (toGet) {
          method = 'GET';
          body = null;
          headers = { ...headers };
          delete headers['content-type'];
          delete headers['content-length'];
        }
        if (next.origin !== current.origin) {
          headers = { ...headers };
          for (const name of ['authorization', 'cookie', 'proxy-authorization']) delete headers[name];
        }
        current = next;
        continue;
      }
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        for (const item of [].concat(value)) responseHeaders.append(name, item);
      }
      // No Accept-Encoding is sent, but a proxy or server can still compress; decode it so
      // `.json()` and `.text()` read the real body, as they do with fetch.
      let answer = NULL_BODY_STATUS.has(response.status) ? null : response.body;
      const encoding = String(responseHeaders.get('content-encoding') || '').toLowerCase().trim();
      if (answer && encoding && encoding !== 'identity') {
        try {
          if (encoding === 'gzip' || encoding === 'x-gzip') answer = zlib.gunzipSync(answer);
          else if (encoding === 'deflate') answer = zlib.inflateSync(answer);
          else if (encoding === 'br') answer = zlib.brotliDecompressSync(answer);
          else throw new Error('unsupported content-encoding');
        } catch (error) {
          throw new TypeError('fetch failed', { cause: Object.assign(new Error('cannot decode the answer'), { code: 'ERR_CONTENT_DECODING' }) });
        }
        responseHeaders.delete('content-encoding');
        responseHeaders.delete('content-length');
      }
      const result = new Response(answer, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
      // `url` and `redirected` describe the final hop, as they do for fetch.
      Object.defineProperty(result, 'url', { value: current.href });
      Object.defineProperty(result, 'redirected', { value: hops > 0 });
      return result;
    }
  };
}

const egressFetch = createEgressFetch();

// True when something replaced the global fetch after this module loaded (a test stub). Callers
// that choose between `fetch` and the tunnel themselves use it to stay on the replacement.
const isFetchReplaced = () => globalThis.fetch !== nativeFetch;

module.exports = { proxyFor, requestViaProxy, egressFetch, createEgressFetch, isFetchReplaced, isLocalHost, excludedByNoProxy, nodeProxiesFromEnv };
