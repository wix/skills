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
//   node scripts/rp-telemetry.js finalize '<rollup-json>'
//   node scripts/rp-telemetry.js rebuild [--attempt <n>] [--push]
//   node scripts/rp-telemetry.js status
//
// Output: one JSON object on stdout. {"ok":true,...} on success; on rejection
// {"ok":false,"errors":[...],"hint":...} with exit code 1 — fix and retry.

const fs = require('node:fs');
const recorder = require('../lib/telemetry-recorder.js');

const VALUE_FLAGS = new Set(['--project', '--outcome', '--halt', '--skill', '--what', '--attempt', '--stage']);
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
        'commands: start, dims, record, stage start|end, meter, wait start|end, finalize, rebuild, status',
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
