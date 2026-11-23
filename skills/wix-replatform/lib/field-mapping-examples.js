'use strict';

// Used inside the existing codegen Developer pass, never by read-only QA.
//
// The after-codegen dry run. For every entity with records in data/source-extract it samples real
// records (coverage first, capped per entity) and runs them through the generated builders; each
// prepared request is checked against what the plan says for that record: the value after the
// plan's transform, outputs the plan omits absent, holds where the valuePolicy holds, dropped
// fields absent. Result rows store only anonymized values (lib/anonymize.js); the request
// captures stay in the project's state/ like every other local evidence file. Mapper-written
// synthetic examples (exampleBase/examples) are only the fallback for an entity without records.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createWixCaptureClient } = require('../resources/rp-target-wix/lib/wix-writers.js');
const { canonical, digest, entityRows, entityRef, validateEntity, assertExecutionScope } = require('./mapping-field-contract.js');
const WriterShape = require('./writer-request-shape.js');
const { projectAnonymizer } = require('./anonymize.js');
const Applicability = require('./output-applicability.js');
const { gateSuppliedReferences } = require('./dependency-readiness.js');
function readValues(value, fieldPath) {
  const tokens = fieldPath.replace(/\[\]/g, '.[]').split('.');
  function walk(v,i) {
    if (i===tokens.length) return [v];
    if (tokens[i]==='[]') return Array.isArray(v) ? v.flatMap(x=>walk(x,i+1)) : [undefined];
    return walk(v && Object.hasOwn(v,tokens[i]) ? v[tokens[i]] : undefined,i+1);
  }
  return walk(value,0);
}
// An example names only the fields its decision reads. A writer that checks the whole request
// (Import Order needs status and buyer details) needs the rest: the entity's mapper-authored
// `exampleBase` supplies it, and the example's own values win.
function exampleInput(base, input) {
  if (base===undefined) return structuredClone(input);
  const plain=v=>v!==null && typeof v==='object' && !Array.isArray(v);
  const merge=(a,b)=>plain(a) && plain(b) ? Object.fromEntries([...new Set([...Object.keys(a),...Object.keys(b)])].map(k=>[k,Object.hasOwn(b,k)?merge(a[k],b[k]):structuredClone(a[k])])) : structuredClone(b);
  return merge(base,input);
}
// One execution of the generated code for one decision on one input, through an isolated capture
// client. Returns the captured requests, requests refused for hitting an unreviewed endpoint,
// the builder's findings and any error code (a builder hold is an error carrying `findings`).
async function runOnce({ capturePath, passId, ref, decision, input, exampleId, execute, sourceRecord=false }) {
  // No configuration spread: credentials, projectDir and live sinks cannot leak in.
  const capture=createWixCaptureClient({requestCapturePath:capturePath,
    runId:`field-example:${passId}:${decision.id}:${exampleId}`});
  // The harness, not the adapter, tags each request with the decision operation whose reviewed
  // endpoint it hits. A request the adapter tags with an operation whose reviewed endpoint it
  // does not hit is refused: it is recorded and counted for no expectation.
  const reviewed=[...new Map((decision.outputs || []).map(o=>[o.writeOperation,WriterShape.endpoint(o.targetRef,o.writeOperation)])).entries()];
  const refused=[];
  const wix=Object.freeze({dryRun:true, send:request=>{
    const url=String(request?.url || ''), at=url.replace(/^https:\/\/www\.wixapis\.com(?=\/)/,'');
    const hits=reviewed.filter(([,e])=>e && e.test(request?.method || '',at)).map(([op])=>op);
    const claimed=request?.operation, claimedEndpoint=reviewed.find(([op])=>op===claimed)?.[1];
    let operation=hits.includes(claimed) ? claimed : hits[0] || (claimedEndpoint ? undefined : claimed);
    if (!hits.length && claimedEndpoint) refused.push({operation:claimed,endpoint:`${String(request?.method || '').toUpperCase()} ${at}`,reviewedEndpoint:`${claimedEndpoint.method} ${claimedEndpoint.path}`});
    const {operation:_ignored,...rest}=request || {};
    return capture.send(operation ? {...rest,operation} : rest);
  }});
  const before=fs.readFileSync(capturePath,'utf8').split('\n').filter(Boolean).length;
  let findings=[], error=null, built;
  try {
    const result=await execute({ sourceEntityRef:ref, decisionId:decision.id,
      // The callback executes the actual generated transform and request builder.
      input, wix, crosswalk:new Map(), exampleId, sourceRecord });
    findings=result?.findings || [];
    built=result?.built;
  } catch(e) {
    error=e.code || e.name || 'example_failed';
    if (Array.isArray(e.findings)) findings=e.findings;
  }
  const captures=fs.readFileSync(capturePath,'utf8').split('\n').filter(Boolean).slice(before).map(JSON.parse);
  return { captures, refused, findings, error, built };
}

function bodyValues(output, body) {
  const shape=WriterShape.shape(output.targetRef,output.writeOperation);
  const boundPath=typeof output.writeInput!=='string' || output.writeInput==='$' ? output.targetPath : `${output.writeInput}.${output.targetPath}`;
  if (shape) return WriterShape.records(body,shape).flatMap(r=>readValues(r,WriterShape.recordPath(output)));
  // A bulk writer that declares only its item list (reviews[]): each item is one record.
  const items=WriterShape.bulkItems(output.targetRef,output.writeOperation,body);
  return items ? items.flatMap(r=>readValues(r,output.targetPath)) : readValues(body,boundPath);
}
function actualValues(output, captures) {
  const matching=captures.filter(c=>c.operation===output.writeOperation);
  return { matching, actual:matching.flatMap(c=>bodyValues(output,c.body)) };
}
// An empty string in the request that the builder did not write: a fixed toolkit writer's
// placeholder for "no value" (a blog category's description). It counts as omitted.
function writerEmptyOnly(output, actual, built) {
  if (built===undefined || built===null || !actual.length || !actual.every(v=>v===undefined || v==='')) return false;
  let fromBuilder;
  try { fromBuilder=bodyValues(output,built); } catch { return false; }
  return fromBuilder.every(v=>v===undefined);
}

// Outputs a fixed toolkit stage writes from the plan, not the generated builder: order payments
// and refunds (order history), shipping options (shipping-option stage), review moderation (the
// review composite's follow-up step, which needs the created review's id) and packed source-archive items.
const { ARCHIVE_COLLECTION_PREFIX }=require('../resources/rp-target-wix/lib/source-archive.js');
function toolkitStage(output) {
  if (output.targetRef==='ecom/order-payment' && output.writeOperation==='writeOrderPayment') return 'order-history payment step';
  if (output.targetRef==='ecom/order-refund' && output.writeOperation==='ensureOrderPaymentAndRefund') return 'order-history refund step';
  if (output.targetRef==='ecom/shipping-option' && output.writeOperation==='createShippingOptionVerified') return 'shipping-option stage';
  if (output.targetRef==='stores/review' && output.writeOperation==='moderateStoresReview') return 'review moderation step';
  const collection=output.storage && output.storage.collectionId;
  if (output.targetRef==='cms/data-item' && output.writeOperation==='insertDataItem' && typeof collection==='string' && collection.startsWith(ARCHIVE_COLLECTION_PREFIX)) return 'source-archive step';
  return null;
}

// ---------- real source records (design v2 D1) ----------

const DEFAULT_SAMPLE_CAP=20;

// data/source-extract/<entity>.ndjson, or the file the extract manifest names for the entity.
function extractFile(projectDir, ref) {
  const dir=path.join(projectDir,'data','source-extract');
  try {
    const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
    const hit=(manifest.entities || []).find(e=>e.entity===ref && typeof e.file==='string');
    if (hit) {
      const file=path.resolve(projectDir,hit.file);
      if (file.startsWith(path.resolve(projectDir)+path.sep) && fs.existsSync(file)) return file;
    }
  } catch { /* no manifest: fall back to the conventional name */ }
  const file=path.join(dir,`${ref}.ndjson`);
  return fs.existsSync(file) ? file : null;
}

function readExtract(file) {
  return fs.readFileSync(file,'utf8').split('\n').filter(l=>l.trim()).map(l=>JSON.parse(l));
}

function valueState(v) {
  if (v===undefined) return 'missing';
  if (v===null) return 'null';
  if (v==='' || (Array.isArray(v) && !v.length) || (v && typeof v==='object' && !Array.isArray(v) && !Object.keys(v).length)) return 'empty';
  if (v===0 || (typeof v==='string' && /^-?0+(\.0+)?$/.test(v.trim()))) return 'zero';
  return 'present';
}

// The record's state for an output: present when any source path has a value, else the first
// non-present state. Array paths (`line_items[].sku`) count as present when any element has one.
function sourceState(record, sourcePaths) {
  const states=sourcePaths.map(p=>{
    const values=readValues(record,p);
    if (p.includes('[]')) {
      // No repeated element at all (a simple product has no _variations) is not a missing value:
      // there is nothing to map, and the value policy speaks about elements that exist.
      const container=readValues(record,p.slice(0,p.indexOf('[]')));
      if (!container.some(c=>Array.isArray(c) && c.length)) return 'no-elements';
      const s=values.map(valueState);
      return s.includes('present') ? 'present' : s.includes('zero') ? 'zero' : s[0] || 'missing';
    }
    return valueState(values[0]);
  });
  if (states.includes('present')) return 'present';
  return ['zero','empty','null','missing','no-elements'].find(s=>states.includes(s)) || 'missing';
}

function outputSourcePaths(decision, output) {
  return (output.sourcePaths && output.sourcePaths.length ? output.sourcePaths : decision.sourcePaths) || [];
}

// Coverage-first sample in file order: for each decision, up to two records where its source
// is present and one for each other state the file has (missing, null, empty, zero), then the
// first records up to the cap. Deterministic for one extract.
function sampleRecords(records, decisions, cap) {
  const chosen=new Set();
  const want=new Map();
  for (const d of decisions) want.set(d.id,{present:2,missing:1,null:1,empty:1,zero:1});
  for (let i=0;i<records.length && chosen.size<cap;i+=1) {
    let useful=false;
    for (const d of decisions) {
      const quota=want.get(d.id);
      const state=sourceState(records[i],d.sourcePaths || []);
      if (quota[state]>0) { quota[state]-=1; useful=true; }
    }
    if (useful) chosen.add(i);
  }
  for (let i=0;i<records.length && chosen.size<cap;i+=1) chosen.add(i);
  return [...chosen].sort((a,b)=>a-b).map(i=>records[i]);
}

function looselyEqual(expected, actual) {
  if (canonical(expected)===canonical(actual)) return true;
  if (expected===null || actual===null || typeof expected==='object' || typeof actual==='object') return false;
  const e=String(expected).trim(), a=String(actual).trim();
  if (e===a) return true;
  const num=/^-?\d+(\.\d+)?$/;
  return num.test(e) && num.test(a) && Number(e)===Number(a);
}

// What the plan says this output must be for this record. Computed from the plan alone, before
// the generated code runs: the source value after the plan's transform, or the valuePolicy action.
// Transforms the toolkit cannot evaluate (expression, helper, instruction) are checked for
// presence only; that is said in the row, never passed off as a value check.
function planExpectation(record, decision, output, choices={}) {
  const sourcePaths=outputSourcePaths(decision,output);
  // The plan writes this output only for some records (a money-off amount only for fixed coupons).
  if (output.appliesWhen!==undefined && !Applicability.evaluate(output.appliesWhen,record,{ choices })) return { check:'omitted', state:'not-applicable' };
  // The row says this output is not in the prepared request (written by a later step, or by a
  // composite from another record): verification.unverifiableReason, or its own examples expect
  // no write. The pass follows the row instead of expecting a value.
  if (output.verification?.unverifiableReason) return { check:'not-checked', state:'not-in-request', why:`not in the prepared request: ${output.verification.unverifiableReason}` };
  const rowExpectations=(decision.examples || []).flatMap(e=>e.expected || []).filter(e=>e.outputId===output.id);
  if (rowExpectations.length && rowExpectations.every(e=>e.noWrite===true)) return { check:'not-checked', state:'not-in-request', why:'the row\'s examples expect no write for this output' };
  if (WriterShape.isDirective(output)) return { check:'not-checked', state:'directive', why:`${output.targetPath} is a ${output.writeOperation} directive the writer strips before the request` };
  // References are written by the dependency gate at import, never by the builder.
  if (gateSuppliedReferences([output.targetRef],output.targetPath).length || (decision.referencePolicy && decision.referencePolicy.targetPath===output.targetPath)) return { check:'not-checked', state:'reference', why:'the dependency gate supplies this reference at import' };
  const state=sourceState(record,sourcePaths);
  if (state==='no-elements') return { check:'not-checked', state, why:'the record has no repeated elements for this output' };
  const t=decision.transform || {};
  if (state!=='present') {
    const policy=decision.valuePolicy?.[state];
    const action=policy?.action;
    if (state==='zero' && (!action || action==='write-as-is')) return transformExpectation(record, t, sourcePaths, decision);
    if (action==='omit-output') return { check:'omitted', state };
    if (action==='write' && Object.hasOwn(policy,'value')) return { check:'value', values:[policy.value], state };
    if (action==='write-as-is') return transformExpectation(record, t, sourcePaths, decision, state);
    if (action==='hold-record') return { check:'hold', codes:policy.code ? [policy.code] : [], state };
    if (action==='return-to-mapping') return { check:'return-to-mapping', state };
    return { check:'not-checked', state, why:`value policy ${action || 'absent'} for ${state}` };
  }
  return transformExpectation(record, t, sourcePaths, decision, state);
}

function transformExpectation(record, t, sourcePaths, decision, state='present') {
  const single=sourcePaths.length===1 && !sourcePaths[0].includes('[]');
  const value=single ? readValues(record,sourcePaths[0])[0] : undefined;
  switch (t.kind) {
    case 'identity':
      return single ? { check:'value', values:[value], state } : { check:'present', state, why:'identity over several or repeated source paths' };
    case 'lookup': {
      if (!single) return { check:'present', state, why:'lookup over several or repeated source paths' };
      const cases=t.cases || {};
      if (Object.hasOwn(cases,String(value))) return { check:'value', values:[cases[String(value)]], state };
      const unknown=t.unknown || decision.valuePolicy?.unknown || {};
      if (unknown.action==='hold-record') return { check:'hold', codes:unknown.code ? [unknown.code] : [], state:'unknown' };
      if (unknown.action==='omit-output') return { check:'omitted', state:'unknown' };
      if (unknown.action==='write' && Object.hasOwn(unknown,'value')) return { check:'value', values:[unknown.value], state:'unknown' };
      return { check:'not-checked', state:'unknown', why:`lookup has no case for this value and unknown is ${unknown.action || 'absent'}` };
    }
    case 'constant':
      return Object.hasOwn(t,'value') ? { check:'value', values:[t.value], state } : { check:'present', state };
    case 'source-field': {
      const v=t.sourcePath ? readValues(record,t.sourcePath) : [];
      return t.sourcePath && !t.sourcePath.includes('[]') ? { check:'value', values:[v[0]], state } : { check:'present', state };
    }
    case 'affix': {
      const prefix=t.prefix || '', suffix=t.suffix || '';
      if (!t.base && single && typeof value==='string') return { check:'value', values:[`${prefix}${value}${suffix}`], state };
      return { check:'affix', prefix, suffix, state };
    }
    default:
      return { check:'present', state, why:`${t.kind || 'unknown'} transform is checked for presence only` };
  }
}

// Every hold code the entity's plan declares (value policies, lookup unknowns, readiness rules).
function declaredHoldCodes(entity) {
  const codes=new Set();
  (function walk(v,key) {
    if (Array.isArray(v)) return v.forEach(x=>walk(x,key));
    if (v && typeof v==='object') return Object.entries(v).forEach(([k,x])=>walk(x,k));
    if ((key==='code' || key==='holdCode') && typeof v==='string') codes.add(v);
  })({fieldMappings:entity.fieldMappings,readBackContract:entity.readBackContract,verificationMappings:entity.verificationMappings});
  return codes;
}

// Hold and outcome codes the fixed toolkit itself raises: kebab-case string literals in the
// toolkit's library code (lib/ and resources/*/lib/). Generated code lives in the migration
// project, never here. Callers may pass an explicit list instead.
let toolkitCodeCache=null;
function toolkitHoldCodes(explicit) {
  if (Array.isArray(explicit)) return new Set(explicit);
  if (toolkitCodeCache) return toolkitCodeCache;
  const codes=new Set(), skill=path.resolve(__dirname,'..');
  const dirs=[path.join(skill,'lib')];
  try { for (const r of fs.readdirSync(path.join(skill,'resources'))) dirs.push(path.join(skill,'resources',r,'lib')); } catch { /* no resources */ }
  for (const dir of dirs) {
    let names=[]; try { names=fs.readdirSync(dir).filter(n=>n.endsWith('.js')); } catch { continue; }
    for (const name of names) for (const m of fs.readFileSync(path.join(dir,name),'utf8').matchAll(/['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+)+)['"`]/g)) codes.add(m[1]);
  }
  toolkitCodeCache=codes;
  return codes;
}

function holdCodes(run) {
  const codes=(run.findings || []).map(f=>f && f.code).filter(Boolean);
  if (!codes.length && typeof run.error==='string' && run.error.startsWith('builder-held:')) codes.push(...run.error.slice('builder-held:'.length).split(','));
  return codes;
}

// Dropped fields: a value the plan excludes must not appear in the entity's own writes, unless
// the same value also comes from a source path the plan maps. Archive writes (the private
// source-archive collection keeps whole records by design) are not the entity's writes.
function droppedLeaks(record, entity, captures) {
  const excluded=(entity.fieldMappings || []).filter(d=>d.disposition==='excluded');
  if (!excluded.length) return [];
  const mappedValues=new Set();
  for (const d of entity.fieldMappings || []) if (d.disposition!=='excluded') for (const p of d.sourcePaths || []) for (const v of readValues(record,p)) if (typeof v==='string' || typeof v==='number') mappedValues.add(String(v));
  const bodies=captures.filter(c=>!/source-archive/.test(JSON.stringify(c.body || {}).slice(0,400)) && !/^insertDataItem|^bulkInsertDataItems/.test(c.operation || '')).map(c=>JSON.stringify(c.body || {}));
  const leaks=[];
  for (const d of excluded) for (const p of d.sourcePaths || []) for (const v of readValues(record,p)) {
    if ((typeof v!=='string' && typeof v!=='number') || String(v).trim().length<4 || mappedValues.has(String(v))) continue;
    const needle=JSON.stringify(String(v)).slice(1,-1);
    if (bodies.some(b=>b.includes(needle))) leaks.push({decisionId:d.id,sourcePath:p});
  }
  return leaks;
}

async function runRealRecords(args) {
  const { ref, rows }=args;
  const start=rows.length;
  await runRealRecordRows(args);
  const mine=rows.slice(start);
  // Presence: an output never written for any sampled record that has its source fails; written
  // for some, the misses are reported as not-checked (the transform emptied that value).
  const byOutput=new Map();
  for (const r of mine) if (r.outputId) { const k=`${r.decisionId}\u0000${r.outputId}`; if (!byOutput.has(k)) byOutput.set(k,[]); byOutput.get(k).push(r); }
  for (const group of byOutput.values()) {
    const misses=group.filter(r=>r.status==='not-written');
    if (!misses.length) continue;
    const everWritten=group.some(r=>r.status==='passed' && r.expected?.check==='present');
    for (const r of misses) {
      if (everWritten) { r.status='not-checked'; r.reason=`${r.reason}; written for other sampled records, so this transform result is taken as empty`; }
      else { r.status='failed'; r.returnTo='codegen'; r.reason=`${r.reason}, for every sampled record that has the source`; }
    }
  }
  const records=new Set(mine.map(r=>r.exampleId));
  // A record is held when none of its outputs was written and checked.
  const written=new Set(mine.filter(r=>r.status==='passed').map(r=>r.exampleId));
  const heldRecords=new Set(mine.filter(r=>r.status==='held' && !written.has(r.exampleId)).map(r=>r.exampleId));
  if (records.size>1 && heldRecords.size===records.size) {
    // Every record held. A hold the plan names, or one the fixed toolkit raises (a payment
    // currency halt on every order), is correct behaviour: sending it back to codegen would loop.
    // It is reported as not-checked. Only codes from the generated code itself fail.
    const declared=declaredHoldCodes(args.entity), toolkit=toolkitHoldCodes(args.toolkitHoldCodes);
    const codes=[...new Set(mine.filter(r=>r.status==='held').flatMap(r=>r.holdCodes || []))].sort();
    const generated=codes.filter(c=>!declared.has(c) && !toolkit.has(c));
    rows.push({ sourceEntityRef:ref, decisionId:null, outputId:null, exampleId:null, sourceRecord:true,
      writeOperation:null, passId:args.passId, inputDigest:null, expectedDigest:null, captureRef:args.captureRef, captureDigest:null, requestCaptureIds:[],
      expected:null, actual:[], findings:[], holdCodes:codes,
      ...(generated.length || !codes.length
        ? { status:'failed', returnTo:'codegen', reason:`the builder held every sampled ${ref} record (${records.size})${generated.length ? ` with ${generated.join(',')}, which neither the plan nor the toolkit raises` : ''}` }
        : { status:'not-checked', reason:`every sampled ${ref} record (${records.size}) is held by plan or toolkit rules (${codes.join(',')}); reported, not sent back to codegen` }) });
  }
}

// Another output of the plan that writes the same request field for this record.
function sharedWriter(decisions, decision, output, record, choices) {
  for (const d of decisions) for (const o of d.outputs || []) {
    if (o===output || o.writeOperation!==output.writeOperation || o.targetPath!==output.targetPath) continue;
    if (planExpectation(record, d, o, choices).check!=='omitted') return { decisionId:d.id, outputId:o.id };
  }
  return null;
}

async function runRealRecordRows({ projectDir, entity, ref, records, capturePath, captureRef, passId, execute, rows, anonymizer }) {
  // Scalars are pseudonymized by their target field, then scrubbed of every real value the
  // anonymizer learned from the sampled records. Objects (a whole archived record packs values
  // without their keys) are never stored: only their digest and size.
  const hide=(targetPath, v)=>{
    if (v && typeof v==='object') return { redacted:'object', digest:digest(v), size:JSON.stringify(v).length };
    const out=anonymizer.valueAt(targetPath, v);
    return typeof out==='string' ? anonymizer.scrubText(out) : out;
  };
  for (const record of records) anonymizer.record(record);
  const declared=declaredHoldCodes(entity);
  const decisions=(entity.fieldMappings || []).filter(d=>d.disposition!=='excluded' && (d.outputs || []).length);
  const choices=Applicability.planChoiceValues(entity);
  for (const record of records) {
    const sourceId=record && (record.id ?? record.sourceId ?? record.sourceKey);
    const exampleId=`record:${sourceId}`;
    let leakChecked=false;
    for (const decision of decisions) {
      const run=await runOnce({ capturePath, passId, ref, decision, input:structuredClone(record), exampleId, execute, sourceRecord:true });
      const codes=holdCodes(run);
      const wrote=run.captures.length>0;
      if (!leakChecked && wrote) {
        leakChecked=true;
        for (const leak of droppedLeaks(record, entity, run.captures)) rows.push({ sourceEntityRef:ref, decisionId:leak.decisionId, outputId:null, exampleId, sourceRecord:true,
          writeOperation:null, passId, inputDigest:digest(record), expectedDigest:null, captureRef, captureDigest:digest(run.captures), requestCaptureIds:run.captures.map(c=>c.requestCaptureId),
          expected:{check:'dropped-absent',sourcePath:leak.sourcePath}, actual:[{present:true}], findings:[], status:'failed', returnTo:'codegen',
          reason:`dropped field ${leak.sourcePath} is written although the plan excludes it` });
      }
      for (const output of decision.outputs) {
        const exp=planExpectation(record, decision, output, choices);
        const { matching, actual }=actualValues(output, run.captures);
        const offEndpoint=run.refused.filter(r=>r.operation===output.writeOperation);
        const held=!matching.length && (codes.length>0);
        let status='passed', reason=null, returnTo, heldWith=null;
        if (offEndpoint.length) { status='failed'; reason=`request sent to ${offEndpoint[0].endpoint}, not the reviewed ${output.writeOperation} endpoint ${offEndpoint[0].reviewedEndpoint}`; }
        else if (exp.check==='return-to-mapping') {
          status='failed'; returnTo='mapping'; reason=`a real record has ${exp.state} ${outputSourcePaths(decision,output).join(', ')} and the plan says return-to-mapping: decide it in the plan`;
        } else if (exp.check==='hold') {
          const ok=!matching.length && (!exp.codes.length || exp.codes.every(c=>codes.includes(c)));
          if (!ok) { status='failed'; reason=matching.length ? `the plan holds this record (${exp.codes.join(',') || exp.state}) but the builder wrote it` : `held with ${codes.join(',') || run.error || 'no finding'}, not the plan's ${exp.codes.join(',')}`; }
        } else if (held || (!matching.length && run.error)) {
          // A hold the plan does not name usually comes from the fixed toolkit (a Wix hard
          // requirement, a payment outcome). It is reported, not failed; an entity whose every
          // sampled record is held fails below.
          const undeclared=codes.filter(c=>!declared.has(c));
          if (!codes.length) { status='failed'; reason=`generated code failed: ${run.error}`; }
          else { status='held'; heldWith=codes; reason=undeclared.length ? `held with ${undeclared.join(',')}, which the plan does not name` : `record held on purpose by the plan (${codes.join(',')})`; }
        } else if (exp.check==='not-checked') { status='not-checked'; reason=exp.why; }
        else if (!matching.length && toolkitStage(output)) {
          // The fixed toolkit stage writes this output, not the generated builder. An adapter that
          // does not run it has nothing to show; codegen cannot fix that, so it is reported.
          status='not-checked'; reason=`not-checked (toolkit): written by the ${toolkitStage(output)}, which the example adapter did not run`;
        } else if (!matching.length) {
          // No request for this output's operation: fine only when the plan omits the output.
          if (exp.check!=='omitted') { status='failed'; reason=`no ${output.writeOperation} request was prepared`; }
        } else if (exp.check==='omitted') {
          // Two rows split one field by appliesWhen (a simple product's default variant price vs a
          // variable product's variant prices): the value on this record is the other row's.
          const other=!actual.every(v=>v===undefined) && sharedWriter(decisions, decision, output, record, choices);
          if (other) { status='not-checked'; reason=`the plan writes ${output.targetPath} for this record through ${other.decisionId}/${other.outputId}`; }
          else if (writerEmptyOnly(output, actual, run.built)) reason=`the builder omitted it; the fixed ${output.writeOperation} writer sends an empty string for no value`;
          else if (!actual.every(v=>v===undefined)) { status='failed'; reason=`the plan omits this output when the source is ${exp.state}, but the builder wrote it`; }
        } else if (exp.check==='present') {
          // A helper or expression may legitimately turn a value into nothing (tags only, an
          // unresolvable media id). One record is not proof; the output never being written for any
          // sampled record that has the source is (judged after the sample, below).
          if (!actual.length || actual.every(v=>v===undefined)) { status='not-written'; reason=`the source has a value but the builder wrote no ${output.targetPath}`; }
          else reason=exp.why || null;
        } else if (exp.check==='affix') {
          const v=actual.find(x=>x!==undefined);
          if (typeof v!=='string' || !v.startsWith(exp.prefix) || !v.endsWith(exp.suffix)) { status='failed'; reason='the written value lacks the plan\'s prefix/suffix'; }
        } else if (exp.check==='value') {
          const written=actual.filter(v=>v!==undefined);
          if (!written.length) { status='failed'; reason=`the builder wrote no ${output.targetPath}`; }
          else if (!written.every(v=>exp.values.some(e=>looselyEqual(e,v)))) { status='failed'; reason='prepared request differs from the value the plan gives for this record'; }
        }
        if (status==='failed' && !returnTo) returnTo='codegen';
        const expectedView=exp.check==='value' ? {...exp, values:exp.values.map(v=>hide(output.targetPath,v))} : exp;
        rows.push({ sourceEntityRef:ref, decisionId:decision.id, outputId:output.id, exampleId, sourceRecord:true,
          writeOperation:output.writeOperation, passId, inputDigest:digest(record), expectedDigest:digest(exp),
          captureRef, captureDigest:run.captures.length?digest(run.captures):null, requestCaptureIds:matching.map(c=>c.requestCaptureId),
          expected:expectedView, actual:actual.map(v=>v===undefined?{omitted:true}:hide(output.targetPath,v)),
          findings:JSON.parse(anonymizer.scrubText(JSON.stringify(anonymizer.record(run.findings)))), status, ...(heldWith?{holdCodes:heldWith}:{}), ...(returnTo?{returnTo}:{}),
          ...(offEndpoint.length?{refusedCaptures:offEndpoint}:{}), reason:reason ? anonymizer.scrubText(reason) : null });
      }
    }
  }
}

async function runFieldMappingExamples({ projectDir, plan, mappingPlanDigest, execute, passId=crypto.randomUUID(), sampleCap=DEFAULT_SAMPLE_CAP, readRecords, toolkitHoldCodes:toolkitCodes, toolkitGaps=[] }={}) {
  if (!projectDir || !plan || typeof execute!=='function' || !/^[a-zA-Z0-9_-]+$/.test(passId)) throw new Error('projectDir, plan, execute and safe passId required');
  if (!mappingPlanDigest || digest(plan)!==mappingPlanDigest) throw new Error('synthetic examples require the independently pinned mapping digest');
  if (!Number.isInteger(sampleCap) || sampleCap<1) throw new Error('sampleCap must be a positive integer');
  const captureRef=`state/attempts/field-mapping-examples/${passId}.ndjson`;
  const capturePath=path.join(projectDir,captureRef);
  fs.mkdirSync(path.dirname(capturePath),{recursive:true});
  // Exclusive creation retains all older passes and prevents accidental evidence overwrite.
  fs.closeSync(fs.openSync(capturePath,'wx'));
  const rows=[], mappingQuestions=[], sources={};
  let anonymizer=null;
  for (const entity of entityRows(plan)) {
    const ref=entityRef(entity);
    const questions=validateEntity(entity);
    if (questions.length) {
      mappingQuestions.push({sourceEntityRef:ref,returnTo:'mapping',questions});
      rows.push({sourceEntityRef:ref,decisionId:null,outputId:null,exampleId:null,writeOperation:null,passId,
        inputDigest:null,expectedDigest:null,captureRef,captureDigest:null,requestCaptureIds:[],expected:null,actual:[],
        status:'not-run',returnTo:'mapping',reason:questions.join('; ')});
      continue;
    }
    if (!plan.executionScope.resolvedEntityRefs.includes(ref) || entity.targetClassification==='manual-mapping') {
      rows.push({sourceEntityRef:ref,decisionId:null,outputId:null,exampleId:null,writeOperation:null,passId,
        inputDigest:null,expectedDigest:null,captureRef,captureDigest:null,requestCaptureIds:[],expected:null,actual:[],
        status:'not-run',reason:'Deferred scope or a manual runbook has no generated write to exercise.'});
      continue;
    }
    assertExecutionScope(plan,ref,mappingPlanDigest,projectDir);
    // Real source records win; synthetic examples are only the fallback for an entity without them.
    let all=null;
    if (typeof readRecords==='function') all=await readRecords(ref);
    else { const file=extractFile(projectDir,ref); all=file ? readExtract(file) : null; }
    if (Array.isArray(all) && all.length) {
      const decisions=(entity.fieldMappings || []).filter(d=>d.disposition!=='excluded' && (d.outputs || []).length);
      const sample=sampleRecords(all,decisions,sampleCap);
      sources[ref]={mode:'source-records',available:all.length,sampled:sample.length};
      anonymizer=anonymizer || projectAnonymizer(projectDir);
      await runRealRecords({ projectDir, entity, ref, records:sample, capturePath, captureRef, passId, execute, rows, anonymizer, toolkitHoldCodes:toolkitCodes });
      continue;
    }
    const hasExamples=(entity.fieldMappings || []).some(d=>(d.examples || []).length);
    sources[ref]={mode:hasExamples ? 'synthetic-examples' : 'none',available:0,sampled:0};
    if (!hasExamples) {
      if ((entity.fieldMappings || []).some(d=>(d.outputs || []).length)) rows.push({sourceEntityRef:ref,decisionId:null,outputId:null,exampleId:null,writeOperation:null,passId,
        inputDigest:null,expectedDigest:null,captureRef,captureDigest:null,requestCaptureIds:[],expected:null,actual:[],
        status:'not-run',reason:'No source records in data/source-extract and no synthetic examples: nothing to exercise.'});
      continue;
    }
    for (const decision of entity.fieldMappings) for (const example of decision.examples || []) {
      const input=exampleInput(entity.exampleBase,example.input);
      const { captures, refused, findings, error, built }=await runOnce({ capturePath, passId, ref, decision, input, exampleId:example.id, execute });
      for (const expected of example.expected) {
        const output=decision.outputs.find(o=>o.id===expected.outputId);
        if (!output || expected.writeOperation!==output.writeOperation) throw new Error('example expectation must bind an approved output and operation');
        const { matching, actual }=actualValues(output, captures);
        const offEndpoint=refused.filter(r=>r.operation===output.writeOperation);
        const expectedValues=expected.values || (Object.hasOwn(expected,'value')?[expected.value]:[]);
        const passed=!error && !offEndpoint.length && (expected.noWrite===true ? matching.length===0 && expected.findingCodes?.length>0 : expected.omitted===true ? matching.length>0 && (actual.every(v=>v===undefined) || writerEmptyOnly(output, actual, built)) : actual.length>0 && actual.every(v=>v!==undefined) && canonical(actual)===canonical(expectedValues)) &&
          (expected.findingCodes || []).every(code=>findings.some(f=>f.code===code));
        rows.push({ sourceEntityRef:ref,decisionId:decision.id,outputId:output.id,exampleId:example.id,
          writeOperation:output.writeOperation,passId,inputDigest:digest(input),expectedDigest:digest(expected),
          captureRef,captureDigest:captures.length?digest(captures):null,
          requestCaptureIds:matching.map(c=>c.requestCaptureId),expected,actual:actual.map(v=>v===undefined?{omitted:true}:v),
          findings,status:passed?'passed':'failed',...(offEndpoint.length?{refusedCaptures:offEndpoint}:{}),
          reason:error || (offEndpoint.length ? `request sent to ${offEndpoint[0].endpoint}, not the reviewed ${output.writeOperation} endpoint ${offEndpoint[0].reviewedEndpoint}` : passed?null:'prepared request differs from the independently authored expectation') });
      }
    }
  }
  // `held` (a record the plan holds on purpose) and `not-checked` (no value rule to evaluate) are
  // not failures; every other non-passed row is.
  const ran=rows.filter(r=>r.status!=='not-run');
  const result={ passId,captureRef,rows,mappingQuestions,sources,
    ok:mappingQuestions.length===0 && rows.length>0 && ran.length>0 && ran.every(r=>['passed','held','not-checked'].includes(r.status)),
    liveVerified:false, ...(toolkitGaps.length ? { toolkitGaps } : {}) };
  // Durable, anonymized pass record (the same file the codegen adapter writes): the completion
  // report reads the latest pass for the current plan and turns unresolved failures into
  // operator actions (reportRows below).
  fs.writeFileSync(path.join(projectDir,resultRef(passId)),JSON.stringify({...result,mappingPlanDigest,completedAt:new Date().toISOString()},null,1));
  return result;
}

const RESULT_DIR='state/attempts/field-mapping-examples';
const resultRef=passId=>`${RESULT_DIR}/${passId}.result.json`;
const DRY_RUN_FAILED_CODE='FIELD_MAPPING_DRY_RUN_FAILED';

// Cutover handoff: when the latest dry-run pass for the current mapping plan still has failed
// rows, the run went on with generated code that disagrees with the plan (or a record the plan
// has not decided). One import-operator action per entity and return target.
function reportRows(projectDir) {
  const operatorActions=[];
  const dir=path.join(projectDir,RESULT_DIR);
  let planDigest=null;
  try { planDigest=digest(JSON.parse(fs.readFileSync(path.join(projectDir,'mapping/mapping-plan.json'),'utf8'))); } catch { return { operatorActions }; }
  let names=[];
  try { names=fs.readdirSync(dir).filter(n=>n.endsWith('.result.json')); } catch { return { operatorActions }; }
  let latest=null;
  for (const name of names) {
    let r; try { r=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')); } catch { continue; }
    if (!r || r.mappingPlanDigest!==planDigest || typeof r.completedAt!=='string') continue;
    if (!latest || r.completedAt>latest.completedAt) latest=r;
  }
  if (!latest || latest.ok) return { operatorActions };
  const groups=new Map();
  for (const row of latest.rows || []) {
    if (row.status!=='failed') continue;
    const key=`${row.sourceEntityRef}\u0000${row.returnTo || 'codegen'}`;
    if (!groups.has(key)) groups.set(key,{entity:row.sourceEntityRef,returnTo:row.returnTo || 'codegen',rows:[]});
    groups.get(key).rows.push(row);
  }
  for (const g of [...groups.values()].sort((a,b)=>`${a.entity}${a.returnTo}`.localeCompare(`${b.entity}${b.returnTo}`))) {
    const outputs=[...new Set(g.rows.map(r=>[r.decisionId,r.outputId].filter(Boolean).join('/')))].sort();
    const records=new Set(g.rows.map(r=>r.exampleId).filter(Boolean));
    const stage=g.returnTo==='mapping' ? 'mapping' : 'codegen';
    operatorActions.push({
      actionId:`field-mapping-dry-run:${latest.passId}:${g.entity}:${stage}`, code:DRY_RUN_FAILED_CODE, severity:'high', role:'import-operator', entity:g.entity,
      action:`Import Operator: the after-codegen dry run found ${g.rows.length} check(s) on ${outputs.length} ${g.entity} field(s) where the prepared Wix request disagrees with the mapping plan (${outputs.join(', ')}). Records imported with this code may carry wrong or missing values; fix ${stage === 'mapping' ? 'the mapping plan' : 'the generated builder'}, re-run the dry run, then re-import the affected records.`,
      deadlineReason:'before switching traffic; imported records may carry values the plan did not decide',
      affectedCount:records.size, affectedIds:outputs, artifactRefs:[resultRef(latest.passId), latest.captureRef].filter(Boolean),
      importOperatorPrompt:`In the migration project, open ${resultRef(latest.passId)} and read the failed ${g.entity} rows (reason, expected, actual). ${stage === 'mapping' ? 'Decide each listed field in mapping/mapping-plan.json (value policy or transform)' : 'Fix the generated builder for each listed field so it follows mapping/mapping-plan.json'}, re-run the field-mapping dry run until it passes, then re-import the ${g.entity} records written before the fix.`,
      resolutionEvidence:'A newer dry-run pass for the current mapping plan has ok: true.',
    });
  }
  return { operatorActions };
}
function renderExampleResults(result) {
  const safe=v=>JSON.stringify(v).replace(/\|/g,'\\|');
  const real=Object.values(result.sources || {}).some(x=>x.mode==='source-records');
  return ['## Field mapping examples','', real ? 'Real source records sampled from data/source-extract (values anonymized); prepared requests only, no live verification.' : 'Synthetic prepared requests only; no live verification.', '',
    ...((result.toolkitGaps || []).length ? ['Toolkit gaps (in-run overrides of the pass):', ...result.toolkitGaps.map(g=>`- ${g.step} (${g.file}): ${g.why}`), ''] : []),
    '| Decision / output / example | Operation | Expected / actual | Status / reason | Evidence |',
    '| --- | --- | --- | --- | --- |', ...result.rows.map(r=>`| ${r.decisionId} / ${r.outputId} / ${r.exampleId} | ${r.writeOperation} | ${safe(r.expected)} / ${safe(r.actual)} | ${r.status}: ${r.reason || ''} | ${r.captureRef}; pass ${r.passId}; input ${r.inputDigest}; expected ${r.expectedDigest}; capture ${r.captureDigest} |`)].join('\n')+'\n';
}
module.exports={runFieldMappingExamples,toolkitStage,renderExampleResults,readValues,exampleInput,planExpectation,sampleRecords,droppedLeaks,reportRows,DRY_RUN_FAILED_CODE,DEFAULT_SAMPLE_CAP};
