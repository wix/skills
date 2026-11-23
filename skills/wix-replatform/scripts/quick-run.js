#!/usr/bin/env node
'use strict';

// One command for a quick import (Shopify or WooCommerce, new Wix site). See lib/quick-run.js.
const { run, installStopHandlers } = require('../lib/quick-run.js');

// A step must never keep running after this command is stopped: a second run would race it.
installStopHandlers();

run(process.argv.slice(2)).then((answer) => {
  const { exitCode, text, ...json } = answer;
  if (text) process.stdout.write(`${text}\n`);
  else process.stdout.write(`${JSON.stringify(json)}\n`);
  // Exit explicitly once the answer is flushed: no child or timer may keep the process alive.
  process.stdout.write('', () => process.exit(exitCode));
}).catch((error) => {
  process.stdout.write(`${JSON.stringify({ status: 'failed', message: String((error && error.message) || error).slice(0, 400) })}\n`);
  process.stdout.write('', () => process.exit(13));
});
