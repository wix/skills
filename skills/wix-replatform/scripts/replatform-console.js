#!/usr/bin/env node
'use strict';

// Local-only browser control surface. The CLI remains the migration authority; this process
// translates a deliberately small HTTP API into argument-array CLI invocations.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(process.env.REPLATFORM_MIGRATIONS_DIR || path.join(process.cwd(), 'migrations'));
const CLI = path.join(__dirname, 'replatform.js');
const PUBLIC = path.join(__dirname, '..', 'console');
const token = crypto.randomBytes(32).toString('base64url');
const clients = new Map();
const active = new Map();
const MAX_BODY = 52 * 1024 * 1024;
const safeProject = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value);
const projectPath = (project) => { if (!safeProject(project)) throw new Error('invalid project name'); return path.join(ROOT, project); };
const cursorPath = (project) => path.join(projectPath(project), 'state', 'runner', 'console-cursor.json');

function parseArgs() {
  const args = process.argv.slice(2); let port = 4310;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--port') port = Number(args[++i]);
    else if (args[i] === '--host' && args[++i] !== '127.0.0.1') throw new Error('the console only binds to 127.0.0.1');
    else if (args[i] !== '--host') throw new Error(`unknown option: ${args[i]}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be 1–65535');
  return port;
}
function send(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
function originOK(req) { const origin = req.headers.origin; return !origin || origin === `http://127.0.0.1:${server.address().port}`; }
function authorized(req, url, mutation = false) { return url.searchParams.get('token') === token && (!mutation || originOK(req)); }
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new Error('request body is too large'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new Error('request body must be JSON'); }
}
function invoke(args, { onLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let partial = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; partial += chunk; const lines = partial.split('\n'); partial = lines.pop(); for (const line of lines) if (line) onLine?.(line); });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('close', (code, signal) => resolve({ child, code, signal, stdout, stderr }));
  });
}
async function json(args) {
  const result = await invoke(args); const line = result.stdout.trim().split('\n').filter(Boolean).at(-1);
  let value = null; try { value = line ? JSON.parse(line) : null; } catch { /* protocol failure is returned below */ }
  if (result.code !== 0) throw new Error(value?.message || result.stderr.trim() || `CLI failed (${result.code})`);
  if (!value) throw new Error('CLI returned no JSON result'); return value;
}
function broadcast(project, event) {
  if (event.eventId) fs.mkdir(path.dirname(cursorPath(project)), { recursive: true }).then(() => fs.writeFile(cursorPath(project), `${JSON.stringify({ schemaVersion: 1, eventId: event.eventId, timestamp: event.timestamp || new Date().toISOString() })}\n`, 'utf8')).catch(() => {});
  for (const res of clients.get(project) || []) res.write(`id: ${event.eventId || ''}\nevent: migration\ndata: ${JSON.stringify(event)}\n\n`);
}
function launch(project, args) {
  if (active.has(project)) throw new Error('this project already has a console-owned run');
  const child = spawn(process.execPath, [CLI, ...args], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  active.set(project, child); let partial = ''; let stderr = ''; let sawResult = false;
  child.stdout.on('data', (chunk) => { partial += chunk; const lines = partial.split('\n'); partial = lines.pop(); for (const line of lines) {
    try { const event = JSON.parse(line); if (event.type === 'result') sawResult = true; broadcast(project, event); } catch { broadcast(project, { type: 'protocol_error', message: 'The CLI emitted invalid JSONL.' }); }
  }});
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('close', (code) => {
    active.delete(project);
    if (partial) try { const event = JSON.parse(partial); if (event.type === 'result') sawResult = true; broadcast(project, event); } catch {}
    if (!sawResult) broadcast(project, { schemaVersion: 1, eventId: `evt_console_${crypto.randomUUID()}`, timestamp: new Date().toISOString(), type: 'result', state: 'failed', message: stderr.trim() || `CLI exited with ${code}`, result: { schemaVersion: 1, runId: null, outcome: 'failed', nextAction: 'Inspect the console diagnostics and correct the reported input or local prerequisite.' } });
  });
  return child;
}
function runArgs(project, options, resume = false) {
  const args = [resume ? 'resume' : 'run', projectPath(project), '--format', 'jsonl'];
  if (resume) return args;
  const pick = [['sourceUrl', '--source-url'], ['sourceMode', '--source-mode'], ['deliveryMode', '--delivery-mode'], ['destination', '--destination'], ['managementImportMode', '--management-import-mode'], ['agent', '--agent'], ['wallTimeout', '--wall-timeout'], ['idleTimeout', '--idle-timeout'], ['statusInterval', '--status-interval']];
  for (const [key, flag] of pick) if (options[key] !== undefined && options[key] !== '') args.push(flag, String(options[key]));
  for (const name of options.files || []) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(name)) throw new Error('invalid uploaded file name'); args.push('--file', path.join(projectPath(project), 'intake', name)); }
  if (options.oneClick) args.push('--one-click'); if (options.dryRun) args.push('--dry-run'); return args;
}
function scrubStatus(value) { if (value?.eventStream) delete value.eventStream.path; return value; }
function setupCredentialInstructions(project, request) {
  if (request?.kind !== 'manual_action' || request.stage !== 'setup_provisioning' || request.response?.mode !== 'none') return null;
  return {
    command: `cd ${projectPath(project)}\nbash ./scripts/mint-token.sh`,
    confirmation: 'Wait for the success message confirming that WIX_AUTH_TOKEN was written. The token itself must not be displayed.',
  };
}
async function replay(project, cursor, res) {
  const args = ['tail', projectPath(project), '--format', 'jsonl']; if (cursor) args.push('--since', cursor);
  const result = await invoke(args); for (const line of result.stdout.trim().split('\n').filter(Boolean)) { try { const event = JSON.parse(line); res.write(`id: ${event.eventId || ''}\nevent: migration\ndata: ${JSON.stringify(event)}\n\n`); } catch {} }
}
async function staticFile(res, name) {
  const map = { '/': 'index.html', '/app.js': 'app.js', '/app.css': 'app.css', '/json.css': 'json.css', '/account.css': 'account.css' }; const file = map[name];
  if (!file) return false; const content = await fs.readFile(path.join(PUBLIC, file));
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(content); return true;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`); const mutation = ['POST', 'PUT', 'DELETE'].includes(req.method);
  try {
    // Static assets contain no state or secret. The shell itself remains token-gated.
    if (req.method === 'GET' && (url.pathname === '/app.js' || url.pathname === '/app.css' || url.pathname === '/json.css' || url.pathname === '/account.css')) return staticFile(res, url.pathname);
    if (!authorized(req, url, mutation)) return send(res, 403, { error: 'Local console token or origin was rejected.' });
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) { if (await staticFile(res, url.pathname)) return; return send(res, 404, { error: 'Not found' }); }
    if (req.method === 'GET' && url.pathname === '/api/projects') return send(res, 200, await json(['projects', '--format', 'json']));
    // This transient, token-gated response must never enter migration artifacts or event logs.
    if (req.method === 'GET' && url.pathname === '/api/account') return send(res, 200, await json(['account', '--format', 'json']));
    const project = url.searchParams.get('project');
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, scrubStatus(await json(['status', projectPath(project), '--format', 'json'])));
    if (req.method === 'GET' && url.pathname === '/api/tasks') return send(res, 200, await json(['tasks', projectPath(project), '--format', 'json']));
    if (req.method === 'GET' && url.pathname === '/api/doctor') return send(res, 200, await json(['doctor', '--agent', url.searchParams.get('agent') || 'auto', '--format', 'json']));
    if (req.method === 'GET' && url.pathname === '/api/requests') return send(res, 200, await json(['requests', projectPath(project), '--format', 'json']));
    if (req.method === 'GET' && url.pathname === '/api/show') {
      const item = url.searchParams.get('item'); const cursor = url.searchParams.get('cursor') || '0';
      const value = await json(['show', projectPath(project), item, '--cursor', cursor, '--max-bytes', '262144', '--format', 'json']);
      const instructions = /^uar_[0-9a-f-]+$/.test(item || '') ? setupCredentialInstructions(project, value) : null;
      return send(res, 200, instructions ? { ...value, operatorInstructions: instructions } : value);
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      projectPath(project); res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); res.write('retry: 2000\n\n');
      await replay(project, req.headers['last-event-id'] || url.searchParams.get('cursor'), res);
      const set = clients.get(project) || new Set(); set.add(res); clients.set(project, set); req.once('close', () => { set.delete(res); if (!set.size) clients.delete(project); }); return;
    }
    const data = await body(req);
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const dir = path.join(projectPath(data.project), 'intake'); const name = path.basename(String(data.name || ''));
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(name) || !/^[A-Za-z0-9+/=]*$/.test(data.contentBase64 || '')) throw new Error('invalid upload');
      const content = Buffer.from(data.contentBase64, 'base64'); if (!content.length || content.length > 50 * 1024 * 1024) throw new Error('upload must be between 1 byte and 50 MB');
      await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, name), content, { flag: 'wx' }); return send(res, 201, { name });
    }
    if (req.method === 'POST' && url.pathname === '/api/run') { const projectName = data.project; launch(projectName, runArgs(projectName, data.options || {}, data.resume === true)); return send(res, 202, { project: projectName, outcome: 'starting' }); }
    if (req.method === 'POST' && url.pathname === '/api/answer') {
      projectPath(data.project); const args = ['answer', '--project', projectPath(data.project), '--request-id', String(data.requestId), '--format', 'json'];
      if (data.choice !== undefined) args.push('--choice', String(data.choice)); else if (data.text !== undefined) args.push('--text', String(data.text)); else if (data.acknowledged === true) args.push('--acknowledge'); else throw new Error('an answer is required');
      if (data.note !== undefined && data.choice === undefined && data.acknowledged !== true) throw new Error('a note requires a choice or acknowledgement');
      if (data.note !== undefined) args.push('--note', String(data.note));
      if (data.continue) { const streamArgs = args.filter((item, index) => !(item === '--format' || (index && args[index - 1] === '--format'))); streamArgs.push('--format', 'jsonl', '--continue'); launch(data.project, streamArgs); return send(res, 202, { project: data.project, outcome: 'resuming' }); }
      return send(res, 200, await json(args));
    }
    if (req.method === 'POST' && url.pathname === '/api/cancel') return send(res, 200, await json(['cancel', projectPath(data.project), '--reason', String(data.reason || 'canceled by operator'), '--format', 'json']));
    return send(res, 404, { error: 'Not found' });
  } catch (error) { return send(res, 400, { error: error.message || String(error) }); }
});
server.listen(parseArgs(), '127.0.0.1', () => console.log(`RePlatform console: http://127.0.0.1:${server.address().port}/?token=${token}`));
