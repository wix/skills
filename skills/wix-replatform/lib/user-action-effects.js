'use strict';

// The one place a durable user-action answer changes orchestration state. Both CLI entry
// points (`replatform answer` and `scripts/user-action.js answer`) call this, so an effect
// cannot behave differently depending on where the person answered.
const path = require('node:path');
const { loadArtifacts, updateDecisionObject, writeJsonAtomic } = require('./orchestration-state.js');
const { applySiteTypePair, pairForChoice } = require('./destination-choice.js');

async function applyUserActionEffect(projectDir, request, answer) {
  if (!request.effect) return;
  if (request.effect.kind === 'read-back-omission-ack') return require('./read-back-approval.js').acknowledge(projectDir, request, answer);
  if (request.effect.kind === 'approval') return require('./read-back-approval.js').applyApproval(projectDir, request, answer);
  const artifacts = await loadArtifacts(projectDir);
  const decisionsPath = path.join(projectDir, 'orchestration', 'decisions.json');
  const effect = request.effect;
  if (effect.kind === 'decision' && effect.key === 'managementImportMode') {
    const value = effect.choices?.[answer.choice];
    if (!value) return;
    updateDecisionObject(artifacts.decisions, 'managementImportMode', value, { source: 'user', rationale: request.title });
    await writeJsonAtomic(decisionsPath, artifacts.decisions);
    return;
  }
  if (effect.kind === 'decision' && effect.key === 'targetSiteType') {
    // One choice id → both decisions, one write.
    applySiteTypePair(artifacts.decisions, pairForChoice(effect, answer.choice), { rationale: request.title });
    await writeJsonAtomic(decisionsPath, artifacts.decisions);
    return;
  }
  if (effect.kind === 'decision' && effect.key === 'editorWebsiteDecision') {
    const value = effect.choices?.[answer.choice];
    if (!value) throw new Error('editor website decision requires a declared choice');
    updateDecisionObject(artifacts.decisions, 'editorWebsiteDecision', value, { source: 'user', rationale: request.title });
    // "Backend only" is an explicit scope change to management.
    if (value === 'management_only') updateDecisionObject(artifacts.decisions, 'deliveryMode', 'management', { source: 'user', rationale: request.title });
    await writeJsonAtomic(decisionsPath, artifacts.decisions);
    return;
  }
  throw new Error('unsupported user-action effect');
}

module.exports = { applyUserActionEffect };
