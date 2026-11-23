#!/usr/bin/env node
'use strict';

// Logs the user's answer to the rights question to BI, as a telemetry user_decision event.
// The agent asks the question itself (SKILL.md); this script only records the answer.
//
// Usage: node scripts/rights-confirmation.js confirmed|declined --project <abs project dir>
// Run it after telemetry `start`. Prints one JSON line. Logging never stops the run: a telemetry
// failure still exits 0. With no active telemetry run it logs nothing and writes nothing.

const fs = require('node:fs');
const path = require('node:path');
const recorder = require('../resources/rp-telemetry/lib/telemetry-recorder.js');

const RIGHTS_STATEMENT = 'Use this skill only to migrate websites and content that you have the right to transfer to Wix.';
const SUBTYPE = { confirmed: 'accepted', declined: 'declined' };

function rightsEvent(answer) {
  return {
    event_type: 'user_decision',
    stage: 'config',
    subtype: SUBTYPE[answer],
    decision_point: 'rights_confirmation',
    skill: 'wix-replatform',
    severity: 'info',
    what_happened: `rights confirmation ${answer}`,
  };
}

async function logRightsConfirmation(projectDir, answer, deps = {}) {
  if (!Object.hasOwn(SUBTYPE, answer)) throw new Error('answer must be confirmed or declined');
  if (!deps.record && !fs.existsSync(recorder.journalPath(projectDir))) {
    return { ok: true, answer, logged: false, errors: ['no active telemetry run in this project; start telemetry first'] };
  }
  try {
    const result = await (deps.record || recorder.record)(projectDir, rightsEvent(answer));
    return { ok: true, answer, logged: Boolean(result && result.ok !== false), ...(result && result.ok === false ? { errors: result.errors } : {}) };
  } catch (error) {
    return { ok: true, answer, logged: false, errors: [String(error && error.message || error).slice(0, 300)] };
  }
}

async function main(argv) {
  const answer = argv[0];
  const at = argv.indexOf('--project');
  const value = at === -1 ? '' : argv[at + 1] || '';
  if (!Object.hasOwn(SUBTYPE, answer || '') || !value || value.startsWith('--')) {
    process.stdout.write(`${JSON.stringify({ ok: false, errors: ['usage: rights-confirmation.js confirmed|declined --project <dir>'] })}\n`);
    return 2;
  }
  process.stdout.write(`${JSON.stringify(await logRightsConfirmation(path.resolve(value), answer))}\n`);
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });

module.exports = { RIGHTS_STATEMENT, logRightsConfirmation, rightsEvent };
