#!/usr/bin/env node
'use strict';

// Product video plan. Reads the project's product extract and writes
// execution/product-videos.json: attach[] (video files the importer attaches after the verified
// product create) and manual[] (links that become product-video-manual cutover items).
//
//   node product-videos.js plan --project <dir> [--extract data/source-extract/product.ndjson]

const fs = require('node:fs');
const path = require('node:path');
const { planProductVideos } = require('../lib/product-video-extract.js');
const { writeProductVideoPlan } = require('../../../lib/product-videos.js');

function arg(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function readNdjson(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
}

function planProject(projectDir, { extract = 'data/source-extract/product.ndjson', generatedAt } = {}) {
  const file = path.resolve(projectDir, extract);
  const plan = planProductVideos(readNdjson(file));
  return writeProductVideoPlan(projectDir, plan, { generatedAt, source: path.relative(projectDir, file) });
}

function main(argv = process.argv.slice(2)) {
  const [command] = argv;
  const project = arg(argv, '--project');
  if (command !== 'plan' || !project) throw new Error('usage: product-videos.js plan --project <dir> [--extract <product.ndjson>]');
  const doc = planProject(path.resolve(project), { extract: arg(argv, '--extract', 'data/source-extract/product.ndjson') });
  process.stdout.write(`${JSON.stringify({ attach: doc.attach.length, manual: doc.manual.length, plan: 'execution/product-videos.json' })}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { planProject };
