#!/usr/bin/env node
'use strict';

const path = require('node:path');
const C = require('../lib/read-back-contract');
const state = require('../lib/read-back-state');
const { sourceKey } = require('../lib/read-back-inventory');
function problem(code) {
  return Object.assign(new Error(code), {
    code
  });
}
function parse(args) {
  const [command, directory, ...flags] = args;
  if (!['contract', 'inventory', 'validate', 'summary', 'draft-stubs'].includes(command) || !directory || directory.startsWith('--')) throw problem('usage');
  const options = {};
  for (let i = 0; i < flags.length; i += 2) {
    const name = flags[i];
    if (!['--entity', '--extract', '--builder', '--source-key', '--format', '--omissions'].includes(name) || !flags[i + 1] || flags[i + 1].startsWith('--') || Object.hasOwn(options, name)) throw problem('usage');
    options[name] = flags[i + 1];
  }
  if (command !== 'summary' && !options['--entity']) throw problem('entity_required');
  if (options['--entity']) C.entityKey(options['--entity']);
  const allowed = command === 'inventory' ? ['--entity', '--extract', '--builder', '--source-key', '--format'] : command === 'contract' ? ['--entity','--omissions'] : ['--entity'];
  if (Object.keys(options).some(key => !allowed.includes(key))) throw problem('usage');
  if (options['--omissions'] && options['--omissions'] !== 'review') throw problem('usage');
  return {
    command,
    projectDir: path.resolve(directory),
    entity: options['--entity'],
    options
  };
}
const { deferredMapping } = require('../lib/read-back-validate');
async function run(args) {
  const {
    command,
    projectDir,
    entity,
    options
  } = parse(args);
  if (command === 'contract') {
    const plan = await state.readJson(projectDir, 'mapping/mapping-plan.json', {});
    const file = `mapping/entity-decisions/${C.decisionFileName(projectDir, entity)}`;
    const decision = await state.readJson(projectDir, file, {});
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) throw problem('entity_decision_invalid');
    if (plan.fieldContractVersion === 1) {
      const exact = require('../lib/mapping-field-contract');
      const row = exact.readBackRow(plan, entity);
      const entries = row ? [row] : [];
      if (entries.length !== 1) throw problem('entity_decision_invalid');
      entries[0].readBackContract = C.domainContract(entity);
      if (plan.entities && !Array.isArray(plan.entities)) {
        const key = Object.keys(plan.entities).find(key => exact.entityRef({sourceEntity: key, ...plan.entities[key]}) === exact.entityRef(entries[0]));
        plan.entities[key].readBackContract = entries[0].readBackContract;
      }
      // This CLI edits one entity; explicitly retain the other entities' current proposals.
      // One-click cannot approve omissions: a plain call clears leftover proposals (they defer).
      const selectedRef=exact.entityRef(entries[0]);
      const oneClick=require('../lib/mapping-omission-approval').mode(await state.readJson(projectDir,'orchestration/decisions.json',{}))==='one_click';
      const omissionReviewEntityRefs=oneClick ? [] : exact.entityRows(plan)
        .filter(row=>row.omissionReviewRequested===true && exact.entityRef(row)!==selectedRef).map(exact.entityRef);
      if (options['--omissions']==='review') omissionReviewEntityRefs.push(selectedRef);
      await exact.writeMappingAuthority(projectDir, plan, { provisionalEntityRefs: plan.executionScope?.provisionalEntityRefs ?? null,
        omissionReviewEntityRefs: omissionReviewEntityRefs.length ? omissionReviewEntityRefs : null });
    } else await state.atomic(projectDir, file, {
      ...decision,
      readBackContract: C.domainContract(entity)
    });
    return {
      entity,
      status: 'contract-copied',
      domainDigest: C.domainContract(entity).domainDigest
    };
  }
  if (command === 'inventory') {
    // A deferred entity is a durable mapping/cutover gap, not an inventory failure.
    // Check the exact mapping before requiring an extract or builder: its source data
    // may be precisely what the mapper could not read.
    const plan = await state.readJson(projectDir, 'mapping/mapping-plan.json', {});
    const deferred = deferredMapping(plan, entity);
    if (deferred) return { entity, status: 'deferred', code: 'mapping_scope_deferred', deferred, exitCode: 0 };
    if (!options['--extract']) return {
      entity,
      status: 'not-run',
      code: 'extract_missing',
      exitCode: 2
    };
    return require('../lib/read-back-inventory').buildInventory(projectDir, entity, {
      plan,
      extract: options['--extract'],
      builder: options['--builder'],
      sourceKey: options['--source-key'],
      format: options['--format']
    });
  }
  if (command === 'validate') return require('../lib/read-back-validate').validateStatus(projectDir, entity);
  if (command === 'draft-stubs') {
    // Read-only: proposes unresolved stubs for unclaimed descendants of selected metadata values.
    const plan = await state.readJson(projectDir, 'mapping/mapping-plan.json');
    const inv = await state.readJson(projectDir, `execution/read-back-inventory/${entity}.json`);
    if (!inv) return { entity, status: 'not-run', code: 'inventory_missing', exitCode: 2 };
    return { entity, status: 'draft', stubs: C.draftSelectorDescendantStubs(plan, entity, inv) };
  }
  return require('../lib/read-back-summary').projectReadBackSummary(await state.load(projectDir), { entity });
}
async function main(args = process.argv.slice(2)) {
  try {
    const {
      exitCode = 0,
      ...result
    } = await run(args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = exitCode;
    return result;
  } catch (error) {
    // A generated builder or JSON parser may include source values in its message.
    const known = new Set(['usage', 'entity_required', 'project_file_required', 'entity_decision_invalid', 'source_key_invalid', 'source_key_missing', 'builder_required', 'builder_export_missing', 'builder_not_pure', 'source_location_invalid', 'selector_template_ambiguous', 'applies_when_invalid', 'builder_hold_invalid', 'builder_hold_unknown_decision', 'builder_hold_retired', 'extract_record_too_large', 'extract_record_invalid', 'extract_json_invalid', 'extract_json_trailing_data', 'extract_json_array_required', 'extract_json_incomplete', 'extract_options_invalid']);
    const result = {
      status: 'failed',
      code: known.has(error.code) ? error.code : 'read_back_command_failed',
      // Source ids and toolkit remediation only: never the builder's message (it may carry values).
      ...(error.code === 'builder_hold_retired' ? { retired: error.retired, remediation: error.remediation } : {})
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 2;
    return result;
  }
}
if (require.main === module) main();
module.exports = {
  main,
  run,
  parse,
  sourceKey
};
