#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  createUserAction,
  listUserActions,
  readUserAction,
  answerUserAction,
} = require('../lib/user-actions.js');
const { applyUserActionEffect } = require('../lib/user-action-effects.js');

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) result._.push(value);
    else {
      const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      result[key] = key === 'acknowledge' ? true : argv[++index];
    }
  }
  return result;
}

function applyEffect(projectDir, request, answer) {
  return applyUserActionEffect(projectDir, request, answer);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || !args.project) throw new Error('Usage: user-action.js create|list|show|answer --project <path> ...');
  const projectDir = path.resolve(args.project);
  let result;
  if (command === 'create') {
    if (!args.requestFile) throw new Error('create requires --request-file <json>');
    result = await createUserAction(projectDir, JSON.parse(await fs.readFile(path.resolve(args.requestFile), 'utf8')));
  } else if (command === 'list') {
    result = await listUserActions(projectDir, { status: args.status || null });
  } else if (command === 'show') {
    if (!args.request) throw new Error('show requires --request <id>');
    result = await readUserAction(projectDir, args.request);
  } else if (command === 'answer') {
    if (!args.request) throw new Error('answer requires --request <id>');
    const answer = args.acknowledge ? { acknowledged: true, ...(args.note ? { note: args.note } : {}) } : args.choice !== undefined ? { choice: args.choice, ...(args.note ? { note: args.note } : {}) } : { text: args.text };
    result = await answerUserAction(projectDir, args.request, answer, {
      applyEffect: (request, normalized) => applyEffect(projectDir, request, normalized),
    });
  } else throw new Error(`unknown command: ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : error}\n`);
  process.exit(2);
});
