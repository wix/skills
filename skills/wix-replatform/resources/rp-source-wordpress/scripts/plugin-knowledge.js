#!/usr/bin/env node
'use strict';

// Deterministic read API for the plugin profile knowledge base. This is the stable
// interface between skill instructions and the JSON profiles — agents should not grep the
// profiles at runtime, exactly as with rp-target-wix/scripts/domain-knowledge.js.

const fs = require('node:fs');
const path = require('node:path');
const {
  pluginsRoot,
  listPlugins,
  readProfile,
  resolveRoute,
  resolveFromIndexKey,
  listCapabilities,
} = require('../lib/plugin-knowledge.js');
const { detectPlugins, summarizeDetection } = require('../lib/wp-plugin-detect.js');

function usage() {
  return [
    'Usage:',
    '  node scripts/plugin-knowledge.js list-plugins',
    '  node scripts/plugin-knowledge.js read-plugin --slug woocommerce-subscriptions',
    '  node scripts/plugin-knowledge.js resolve-route --route /wc/v3/subscriptions',
    '  node scripts/plugin-knowledge.js resolve-namespace --namespace wc-bookings/v1',
    '  node scripts/plugin-knowledge.js resolve-rest-base --rest-base tribe_events',
    '  node scripts/plugin-knowledge.js resolve-property --property bundled_items',
    '  node scripts/plugin-knowledge.js list-capabilities',
    '  node scripts/plugin-knowledge.js detect --inventory <plugin-inventory.json>',
    '',
    'Add --pretty for human-readable output.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const pluginsDir = pluginsRoot(path.resolve(__dirname, '..'));

  if (!command || args.help) {
    process.stderr.write(`${usage()}\n`);
    process.exit(command ? 0 : 1);
  }

  let output;
  if (command === 'list-plugins') {
    output = { plugins: listPlugins(pluginsDir) };
  } else if (command === 'read-plugin') {
    if (!args.slug) throw new Error('--slug is required');
    output = readProfile(pluginsDir, args.slug);
  } else if (command === 'resolve-route') {
    if (!args.route) throw new Error('--route is required');
    output = { route: args.route, matches: resolveRoute(pluginsDir, args.route) };
  } else if (command === 'resolve-namespace') {
    if (!args.namespace) throw new Error('--namespace is required');
    output = { namespace: args.namespace, plugins: resolveFromIndexKey(pluginsDir, 'namespaceIndex', args.namespace) };
  } else if (command === 'resolve-rest-base') {
    if (!args.restBase) throw new Error('--rest-base is required');
    output = { restBase: args.restBase, plugins: resolveFromIndexKey(pluginsDir, 'restBaseIndex', args.restBase) };
  } else if (command === 'resolve-property') {
    if (!args.property) throw new Error('--property is required');
    output = { property: args.property, plugins: resolveFromIndexKey(pluginsDir, 'recordPropertyIndex', args.property) };
  } else if (command === 'list-capabilities') {
    output = { capabilities: listCapabilities(pluginsDir) };
  } else if (command === 'detect') {
    if (!args.inventory) throw new Error('--inventory is required');
    const inventory = JSON.parse(fs.readFileSync(args.inventory, 'utf8'));
    output = summarizeDetection(inventory);
  } else {
    throw new Error(`Unknown command: ${command}\n${usage()}`);
  }
  process.stdout.write(`${JSON.stringify(output, null, args.pretty ? 2 : 0)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

module.exports = { detectPlugins };
