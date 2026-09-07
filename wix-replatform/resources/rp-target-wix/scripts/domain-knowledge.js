#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  knowledgeRoot,
  listDomains,
  listEntities,
  readEntityByRef,
  resolveSource,
  listFlagged,
  summarizeEntities,
} = require('../lib/domain-knowledge.js');

function usage() {
  return [
    'Usage:',
    '  node scripts/domain-knowledge.js list-domains',
    '  node scripts/domain-knowledge.js list-entities --domain stores',
    '  node scripts/domain-knowledge.js read-entity --ref stores/product',
    '  node scripts/domain-knowledge.js resolve-source --source-system woocommerce --source-entity product',
    '  node scripts/domain-knowledge.js resolve-source --route /wc/v3/products',
    '  node scripts/domain-knowledge.js list-flagged --flag IMPORT_UNRELIABLE',
    '  node scripts/domain-knowledge.js summarize-entities --refs stores/product,ecom/order [--include-evidence]',
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

function print(value, pretty) {
  process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const domainsDir = knowledgeRoot(path.resolve(__dirname, '..'));

  if (!command || args.help) {
    process.stderr.write(`${usage()}\n`);
    process.exit(command ? 0 : 1);
  }

  let output;
  if (command === 'list-domains') {
    output = { domains: listDomains(domainsDir) };
  } else if (command === 'list-entities') {
    if (!args.domain) throw new Error('--domain is required');
    output = { domain: args.domain, entities: listEntities(domainsDir, args.domain) };
  } else if (command === 'read-entity') {
    if (!args.ref) throw new Error('--ref is required');
    output = readEntityByRef(domainsDir, args.ref);
  } else if (command === 'resolve-source') {
    output = {
      matches: resolveSource(domainsDir, {
        sourceSystem: args.sourceSystem,
        sourceEntity: args.sourceEntity,
        route: args.route,
      }),
    };
  } else if (command === 'list-flagged') {
    if (!args.flag) throw new Error('--flag is required');
    output = { flag: args.flag, entities: listFlagged(domainsDir, args.flag) };
  } else if (command === 'summarize-entities') {
    if (!args.refs) throw new Error('--refs is required');
    output = {
      entities: summarizeEntities(domainsDir, args.refs.split(',').filter(Boolean), {
        includeEvidence: Boolean(args.includeEvidence),
      }),
    };
  } else {
    throw new Error(`Unknown command: ${command}\n${usage()}`);
  }
  print(output, Boolean(args.pretty));
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
