'use strict';

// Value contracts from target knowledge (`valueContracts` in an entity file): values Wix refuses
// whatever the request looks like, stated once with why and the nearest workable option. The mapping
// check refuses a plan row whose transform can only produce a refused value, so an operator change
// such as "show old orders as WC-1234" is answered at mapping time in plain words, never by a bare
// 400 on every record at import.
//
// Shape: { "<record path>": { "pattern": "<regex the value must match>", "why": "...", "alternative": "...",
//   "choice": { "name", "value", "default", "decidedBy" } } }
// `choice` is the B1 row choice the mapper records when it applies the alternative (its reason is the
// contract's why), so planChoiceActions turns the changed request into a cutover task.
//
// What is checked is what the plan states, not the source data: an affix's literal text, a
// constant, and the values a lookup writes. A copied source value is checked by the target writer.

const WriterShape = require('./writer-request-shape');

function contractsFor(targetRef) {
  try { return require('./dependency-proofs').domain(targetRef).valueContracts || null; } catch { return null; }
}

// The literal text a transform adds or writes, as the values to test (null: nothing literal).
function literalSamples(t, depth = 0) {
  if (!t || typeof t !== 'object' || depth > 3) return null;
  if (t.kind === 'constant') return [t.value];
  if (t.kind === 'lookup') return Object.values(t.cases || {});
  if (t.kind === 'affix') {
    const inner = literalSamples(t.base, depth + 1) || ['0'];
    return inner.map(v => `${t.prefix || ''}${v}${t.suffix || ''}`);
  }
  return null;
}

// The row choice that records an applied alternative (B1 shape), or null when the contract has none.
function appliedChoice(contract) {
  return contract?.choice ? { ...contract.choice, reason: `${contract.why} ${contract.alternative}` } : null;
}

// Errors for one plan decision: `<id>:<output>: WIX-IMPOSSIBLE ...`.
function valueContractErrors(d) {
  const errors = [];
  const samples = literalSamples(d?.transform);
  if (!samples) return errors;
  for (const o of d.outputs || []) {
    const contracts = contractsFor(o?.targetRef);
    const contract = contracts && contracts[WriterShape.recordPath(o)];
    if (!contract?.pattern) continue;
    const ok = new RegExp(contract.pattern);
    const bad = samples.filter(v => typeof v !== 'string' && typeof v !== 'number' ? true : !ok.test(String(v)));
    if (bad.length) errors.push(`${d.id}:${o.id}: WIX-IMPOSSIBLE: ${contract.why} This change would write ${JSON.stringify(String(bad[0]))}. ${contract.alternative}${appliedChoice(contract) ? ` If you apply it, record it as this row's choice so the operator sees it at cutover: ${JSON.stringify(appliedChoice(contract))}.` : ''}`);
  }
  return errors;
}

module.exports = { valueContractErrors, literalSamples, contractsFor, appliedChoice };
