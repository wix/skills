#!/usr/bin/env node
'use strict';

// CLI for the RePlatform run-telemetry recorder. The rp-telemetry companion
// skill invokes this via bash; the agent never hand-writes the signal layer.
//
// Usage (run against the active migration project via --project or cwd):
//   node scripts/rp-telemetry.js start '<dims-json>' [--project <dir>]
//   node scripts/rp-telemetry.js dims '<dims-json>'
//   node scripts/rp-telemetry.js record '<event-json>'
//   node scripts/rp-telemetry.js stage start <stage>
//   node scripts/rp-telemetry.js stage end <stage> [--outcome <outcome>]
//   node scripts/rp-telemetry.js meter --api-ms 1234 --api-calls 73 [--stage <stage>]
//   node scripts/rp-telemetry.js meter '{"model_ms":42000,"output_tokens":18000}'
//   node scripts/rp-telemetry.js wait start [--halt <subtype> --skill <s> [--what '<text>']]
//   node scripts/rp-telemetry.js wait end
//   node scripts/rp-telemetry.js digest --transcript <path to CC session jsonl> [--offline]
//   node scripts/rp-telemetry.js finalize '<rollup-json>'
//   node scripts/rp-telemetry.js rebuild [--attempt <n>] [--push]
//   node scripts/rp-telemetry.js status
//
// `digest` (spec 0039): call it just before `finalize`. It parses the Claude
// Code session transcript that produced this run — no model, no network, so a
// failure here must never abort the migration (`|| true` it). Pass `--offline`
// when re-running it later against a checkpointed or local transcript to
// produce the digest for a run that died before ever calling it; omitted, the
// digest is the in-run call and necessarily misses the final few turns it is
// itself part of (`source.tail_complete: false`). Also copies this run's
// sessions into telemetry/transcripts/<sessionId>.jsonl.gz + manifest.json.
//
// Output: one JSON object on stdout. {"ok":true,...} on success; on rejection
// {"ok":false,"errors":[...],"hint":...} with exit code 1 — fix and retry.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const recorder = require('../lib/telemetry-recorder.js');
const transcriptDigestLib = require('../lib/transcript-digest.js');

const VALUE_FLAGS = new Set(['--project', '--outcome', '--halt', '--skill', '--what', '--attempt', '--stage', '--transcript']);
// Meter measurements are accepted as kebab-case flags so a shell script can report its own timing
// without composing JSON: --api-ms 1234 --api-calls 73.
const METER_FLAGS = new Map(
  ['model_ms', 'api_ms', 'script_ms', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'api_calls', 'api_retries']
    .map((key) => [`--${key.replace(/_/g, '-')}`, key]),
);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const meter = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (VALUE_FLAGS.has(arg)) {
      flags[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else if (METER_FLAGS.has(arg)) {
      const raw = argv[i + 1];
      const value = Number(raw);
      if (!Number.isFinite(value)) fail([`${arg} expects a number (got: ${raw === undefined ? '(none)' : raw})`]);
      meter[METER_FLAGS.get(arg)] = value;
      i += 1;
    } else if (arg === '--push') {
      flags.push = true;
    } else if (arg === '--offline') {
      flags.offline = true;
    } else if (arg.startsWith('--')) {
      fail([`unknown flag: ${arg}`]);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, meter };
}

function fail(errors, hint) {
  process.stdout.write(`${JSON.stringify({ ok: false, errors, ...(hint ? { hint } : {}) })}\n`);
  process.exit(1);
}

function parseJsonArg(raw, label) {
  if (raw === undefined) fail([`missing ${label} JSON argument`]);
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail([`${label} is not valid JSON: ${error.message}`]);
  }
  return undefined;
}

// Locates a `stage` for a timestamp from this run's own journal, so a retry
// loop or hook block in the digest can be attributed to the stage it fell in
// without the pure parser having to know anything about telemetry stages.
function stageIntervalsFor(state, nowMs) {
  const intervals = state.entries.map((e) => ({ stage: e.stage, start: Date.parse(e.start), end: Date.parse(e.end) }));
  if (state.openStage) {
    intervals.push({ stage: state.openStage, start: Date.parse(state.openStageStart), end: nowMs });
  }
  return (ms) => {
    if (!Number.isFinite(ms)) return null;
    const hit = intervals.find((iv) => ms >= iv.start && ms <= iv.end);
    return hit ? hit.stage : null;
  };
}

async function runDigest(projectDir, transcriptPath, { offline }) {
  const journal = recorder.readJournal(projectDir);
  if (!journal) fail(['no active telemetry run in this project'], "call `rp-telemetry.js start` first");
  const state = recorder.replay(journal.records);
  if (!state.runStart) fail(['telemetry journal is corrupt: missing run-start record']);

  const windowStartMs = Date.parse(state.runStart.ts);
  const nowMs = Date.now();
  const sessions = transcriptDigestLib.discoverRunSessions(transcriptPath, { windowStartMs, windowEndMs: nowMs });
  const digest = transcriptDigestLib.computeDigest(sessions, {
    tailComplete: offline === true,
    stageForTs: stageIntervalsFor(state, nowMs),
  });

  // Copy, never move (spec 0039 §4.1) — Claude Code owns the original.
  const transcriptsDir = path.join(projectDir, 'telemetry', 'transcripts');
  fs.mkdirSync(transcriptsDir, { recursive: true });
  const manifestPath = path.join(transcriptsDir, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  const runId = state.runStart.run_id;
  const sessionIds = new Set(manifest[runId] || []);
  for (const session of sessions) {
    const dest = path.join(transcriptsDir, `${session.sessionId}.jsonl.gz`);
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, zlib.gzipSync(fs.readFileSync(session.path)));
    sessionIds.add(session.sessionId);
  }
  manifest[runId] = [...sessionIds];
  const manifestTemp = `${manifestPath}.${process.pid}.tmp`;
  fs.writeFileSync(manifestTemp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.renameSync(manifestTemp, manifestPath);

  const recorded = await recorder.transcriptDigest(projectDir, digest);
  return { ...recorded, sessions_included: sessions.length, tail_complete: digest.source.tail_complete };
}

async function main() {
  const { positional, flags, meter } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;
  const projectDir = flags.project || process.cwd();
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    fail([`project directory not found: ${projectDir}`], 'pass --project <migration project dir>');
  }

  let result;
  switch (command) {
    case 'start':
      result = await recorder.start(projectDir, rest[0] === undefined ? {} : parseJsonArg(rest[0], 'dims'));
      break;
    case 'dims':
      result = await recorder.dims(projectDir, parseJsonArg(rest[0], 'dims'));
      break;
    case 'record':
      result = await recorder.record(projectDir, parseJsonArg(rest[0], 'event'));
      break;
    case 'stage':
      result = recorder.stage(projectDir, rest[0], rest[1], { outcome: flags.outcome });
      break;
    case 'meter': {
      // Flags and a JSON payload both work; flags win on conflict so a wrapper script can override
      // a template payload without rebuilding the JSON.
      const fromJson = rest[0] === undefined ? {} : parseJsonArg(rest[0], 'meter');
      const payload = { ...fromJson, ...meter };
      if (flags.stage) payload.stage = flags.stage;
      result = recorder.meter(projectDir, payload);
      break;
    }
    case 'wait':
      result = await recorder.wait(projectDir, rest[0], {
        haltSubtype: flags.halt,
        skill: flags.skill,
        what: flags.what,
      });
      break;
    case 'digest':
      if (!flags.transcript) fail(['--transcript <path to Claude Code session jsonl> is required']);
      if (!fs.existsSync(flags.transcript)) fail([`transcript not found: ${flags.transcript}`]);
      result = await runDigest(projectDir, flags.transcript, { offline: flags.offline === true });
      break;
    case 'finalize':
      result = await recorder.finalize(projectDir, parseJsonArg(rest[0], 'rollup'));
      break;
    case 'rebuild':
      result = await recorder.rebuild(projectDir, {
        attempt: flags.attempt === undefined ? undefined : Number(flags.attempt),
        push: flags.push === true,
      });
      break;
    case 'status':
      result = recorder.status(projectDir);
      break;
    default:
      fail(
        [`unknown command: ${command || '(none)'}`],
        'commands: start, dims, record, stage start|end, meter, wait start|end, digest, finalize, rebuild, status',
      );
      return;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

main().catch((error) => {
  if (error instanceof recorder.ValidationError) {
    fail(error.errors, error.hint || undefined);
  }
  fail([error && error.message ? error.message : String(error)]);
});
