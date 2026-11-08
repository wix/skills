'use strict';

// Used inside the existing codegen Developer pass, never by read-only QA.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createWixCaptureClient } = require('../resources/rp-target-wix/lib/wix-writers.js');
const { canonical, digest, entityRows, entityRef, validateEntity, assertExecutionScope } = require('./mapping-field-contract.js');
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
async function runFieldMappingExamples({ projectDir, plan, mappingPlanDigest, execute, passId=crypto.randomUUID() }={}) {
  if (!projectDir || !plan || typeof execute!=='function' || !/^[a-zA-Z0-9_-]+$/.test(passId)) throw new Error('projectDir, plan, execute and safe passId required');
  if (!mappingPlanDigest || digest(plan)!==mappingPlanDigest) throw new Error('synthetic examples require the independently pinned mapping digest');
  const captureRef=`state/attempts/field-mapping-examples/${passId}.ndjson`;
  const capturePath=path.join(projectDir,captureRef);
  fs.mkdirSync(path.dirname(capturePath),{recursive:true});
  // Exclusive creation retains all older passes and prevents accidental evidence overwrite.
  fs.closeSync(fs.openSync(capturePath,'wx'));
  const rows=[], mappingQuestions=[];
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
    for (const decision of entity.fieldMappings) for (const example of decision.examples || []) {
      // No configuration spread: credentials, projectDir and live sinks cannot leak in.
      const wix=createWixCaptureClient({requestCapturePath:capturePath,
        runId:`field-example:${passId}:${decision.id}:${example.id}`});
      const before=fs.readFileSync(capturePath,'utf8').split('\n').filter(Boolean).length;
      let findings=[], error=null;
      const input=exampleInput(entity.exampleBase,example.input);
      try {
        const result=await execute({ sourceEntityRef:ref, decisionId:decision.id,
          // The callback executes the actual generated transform and request builder.
          input, wix, crosswalk:new Map(), exampleId:example.id });
        findings=result?.findings || [];
      } catch(e) { error=e.code || e.name || 'example_failed'; }
      const captures=fs.readFileSync(capturePath,'utf8').split('\n').filter(Boolean).slice(before).map(JSON.parse);
      for (const expected of example.expected) {
        const output=decision.outputs.find(o=>o.id===expected.outputId);
        if (!output || expected.writeOperation!==output.writeOperation) throw new Error('example expectation must bind an approved output and operation');
        const boundPath=`${output.writeInput}.${output.targetPath}`;
        const matching=captures.filter(c=>c.operation===output.writeOperation);
        const actual=matching.flatMap(c=>readValues(c.body,boundPath));
        const expectedValues=expected.values || (Object.hasOwn(expected,'value')?[expected.value]:[]);
        const passed=!error && (expected.noWrite===true ? matching.length===0 && expected.findingCodes?.length>0 : expected.omitted===true ? matching.length>0 && actual.every(v=>v===undefined) : actual.length>0 && actual.every(v=>v!==undefined) && canonical(actual)===canonical(expectedValues)) &&
          (expected.findingCodes || []).every(code=>findings.some(f=>f.code===code));
        rows.push({ sourceEntityRef:ref,decisionId:decision.id,outputId:output.id,exampleId:example.id,
          writeOperation:output.writeOperation,passId,inputDigest:digest(input),expectedDigest:digest(expected),
          captureRef,captureDigest:captures.length?digest(captures):null,
          requestCaptureIds:matching.map(c=>c.requestCaptureId),expected,actual:actual.map(v=>v===undefined?{omitted:true}:v),
          findings,status:passed?'passed':'failed',reason:error || (passed?null:'prepared request differs from the independently authored expectation') });
      }
    }
  }
  return { passId,captureRef,rows,mappingQuestions,ok:mappingQuestions.length===0 && rows.length>0 && rows.filter(r=>r.status!=='not-run').length>0 && rows.filter(r=>r.status!=='not-run').every(r=>r.status==='passed'),
    liveVerified:false };
}
function renderExampleResults(result) {
  const safe=v=>JSON.stringify(v).replace(/\|/g,'\\|');
  return ['## Field mapping examples','', 'Synthetic prepared requests only; no live verification.', '',
    '| Decision / output / example | Operation | Expected / actual | Status / reason | Evidence |',
    '| --- | --- | --- | --- | --- |', ...result.rows.map(r=>`| ${r.decisionId} / ${r.outputId} / ${r.exampleId} | ${r.writeOperation} | ${safe(r.expected)} / ${safe(r.actual)} | ${r.status}: ${r.reason || ''} | ${r.captureRef}; pass ${r.passId}; input ${r.inputDigest}; expected ${r.expectedDigest}; capture ${r.captureDigest} |`)].join('\n')+'\n';
}
module.exports={runFieldMappingExamples,renderExampleResults,readValues,exampleInput};
