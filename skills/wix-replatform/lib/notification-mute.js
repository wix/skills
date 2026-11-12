'use strict';

// One reading of "is notification mute in effect" for every gate. A new site is
// always muted. An existing site is muted only when the operator answered the question
// below; nothing defaults it. A run that already wrote to the site is never stopped to ask.
const fs = require('node:fs/promises');
const path = require('node:path');
const { readEnvFile } = require('./config-env.js');
const { getDecisionValue } = require('./orchestration-decisions.js');

const DECISION_KEY = 'notificationMute';
const ENV_KEY = 'WIX_MUTE_NOTIFICATIONS';
const MUTE_REQUIREMENT_ID = 'mute-site-notifications';
const ANSWERS = Object.freeze(['on', 'off']);

const NOTIFICATION_MUTE_QUESTION = Object.freeze({
  decisionKey: DECISION_KEY,
  question: 'This is an existing, live Wix site. Should we mute its notifications before we start writing to it?',
  choices: Object.freeze([
    Object.freeze({ id: 'on', label: 'Mute', description: 'Wix stops all site notifications, including emails to your customers, until someone unmutes. Your live business may miss real customer notifications during the import.' }),
    Object.freeze({ id: 'off', label: "Don't mute", description: 'Your customers and you may get emails for the records we import (orders, bookings, form submissions, RSVPs, and so on).' }),
  ]),
});

function normalizeAnswer(value) {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  return text === '' ? null : text;
}

// strategy: 'new_site' | 'existing_site' | null. decision/envValue: raw recorded values.
function resolveNotificationMute({ strategy, decision = null, envValue = null, writesStarted = false } = {}) {
  const answer = normalizeAnswer(decision);
  const env = normalizeAnswer(envValue);
  const errors = [];
  if (answer !== null && !ANSWERS.includes(answer)) errors.push({ code: 'invalid_notification_mute', field: DECISION_KEY, value: decision });
  if (env !== null && !ANSWERS.includes(env)) errors.push({ code: 'invalid_notification_mute', field: ENV_KEY, value: envValue });
  if (errors.length) return { strategy, answer, inEffect: null, source: null, needsAnswer: false, errors };
  if (strategy === 'new_site') {
    if (answer === 'off' || env === 'off') return { strategy, answer, inEffect: null, source: null, needsAnswer: false, errors: [{ code: 'new_site_mute_off' }] };
    return { strategy, answer, inEffect: true, source: 'new_site', needsAnswer: false, errors };
  }
  if (strategy !== 'existing_site') return { strategy, answer, inEffect: null, source: null, needsAnswer: false, errors };
  if (answer !== null) {
    if (env !== null && env !== answer) return { strategy, answer, inEffect: null, source: null, needsAnswer: false, errors: [{ code: 'mute_config_conflict', decision: answer, env }] };
    return { strategy, answer, inEffect: answer === 'on', source: 'operator', needsAnswer: false, errors };
  }
  // A run that already wrote keeps what it ran with: never a mid-import question.
  if (writesStarted) return { strategy, answer, inEffect: env === 'on', source: 'legacy_config', needsAnswer: false, errors };
  return { strategy, answer, inEffect: null, source: null, needsAnswer: true, errors };
}

async function maybeReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function readNotificationMute(projectDir, { decisions } = {}) {
  const recorded = decisions || (await maybeReadJson(path.join(projectDir, 'orchestration', 'decisions.json'))) || {};
  let env = {};
  try { env = await readEnvFile(path.join(projectDir, 'config', 'wix.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let strategy = getDecisionValue(recorded, 'targetSiteStrategy');
  if (!strategy) strategy = { new: 'new_site', existing: 'existing_site' }[String(env.WIX_SITE_STRATEGY || '').trim()] || null;
  let writesStarted = true;
  try { await fs.access(path.join(projectDir, 'setup', 'setup-verification.json')); } catch { writesStarted = false; }
  return resolveNotificationMute({ strategy, decision: getDecisionValue(recorded, DECISION_KEY), envValue: env[ENV_KEY], writesStarted });
}

// The setup plan must mute exactly when mute is in effect.
function setupPlanMuteMismatch(resolved, plan) {
  if (!resolved || resolved.inEffect === null || resolved.errors.length) return null;
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const hasMute = steps.some((step) => step && step.id === MUTE_REQUIREMENT_ID);
  if (resolved.inEffect && !hasMute) return { code: 'setup_plan_mute_missing' };
  if (!resolved.inEffect && hasMute) return { code: 'setup_plan_mute_unwanted' };
  return null;
}

function mutedRecorded(verification) {
  const rows = Array.isArray(verification?.requirements) ? verification.requirements : [];
  return rows.some((row) => row && row.id === MUTE_REQUIREMENT_ID && row.status === 'passed');
}

const UNMUTE_PROMPT = 'Open the migration project. Call unmuteSiteNotifications from rp-target-wix with the project\'s CLI site token (WIX_AUTH_TOKEN), then confirm getSiteMuteState returns muted: false. Tell the owner notifications are back on.';

// The completion report's mute block and its cutover reminder.
async function completionReportMute(projectDir) {
  const resolved = await readNotificationMute(projectDir);
  const verification = await maybeReadJson(path.join(projectDir, 'setup', 'setup-verification.json'));
  const muted = mutedRecorded(verification);
  const block = { strategy: resolved.strategy, answer: resolved.answer, inEffect: resolved.inEffect, source: resolved.source, mutedRecorded: muted };
  if (!muted) return { block, actions: [] };
  const existing = resolved.strategy === 'existing_site';
  return {
    block,
    actions: [{
      actionId: 'notifications-muted',
      code: 'notifications-muted',
      severity: 'high',
      role: 'import-operator',
      action: 'Requires Import Operator: all site notifications are muted, including emails to customers and alerts to the owner. They stay muted until someone unmutes them. Unmute the site.',
      deadlineReason: existing
        ? 'Unmute as soon as the import is finished and checked; this live site is missing real customer notifications while muted.'
        : 'Unmute at go-live, before or right after the DNS switch; customers get no site emails while muted.',
      affectedCount: null,
      importOperatorPrompt: UNMUTE_PROMPT,
      artifactRefs: ['setup/setup-verification.json'],
      resolutionEvidence: 'A getSiteMuteState read shows muted: false.',
    }],
  };
}

// The one writer of the operator's answer (the decide command and the durable request both
// call it): user source only, never off on a new site, never changed once setup wrote to the
// site, and mirrored to WIX_MUTE_NOTIFICATIONS so generated code reads the same value.
async function recordNotificationMute(projectDir, value, { source = 'user', rationale = null } = {}) {
  const answer = normalizeAnswer(value);
  if (!ANSWERS.includes(answer)) throw new Error(`notificationMute must be on or off (got: ${value})`);
  if (source !== 'user') throw new Error('notificationMute is the operator\'s answer; record it with source user (never inferred)');
  const { loadArtifacts, updateDecisionObject, writeJsonAtomic } = require('./orchestration-state.js');
  const artifacts = await loadArtifacts(projectDir);
  if (getDecisionValue(artifacts.decisions, 'targetSiteStrategy') === 'new_site' && answer === 'off') {
    throw new Error('a new site is always muted before the first write; notificationMute=off is not allowed for targetSiteStrategy=new_site');
  }
  const previous = normalizeAnswer(getDecisionValue(artifacts.decisions, DECISION_KEY));
  if (previous && previous !== answer && (await maybeReadJson(path.join(projectDir, 'setup', 'setup-verification.json')))) {
    throw new Error(`notificationMute was already answered ${previous} and setup has written to the site; it cannot change mid-import`);
  }
  updateDecisionObject(artifacts.decisions, DECISION_KEY, answer, { source: 'user', rationale });
  await writeJsonAtomic(path.join(projectDir, 'orchestration', 'decisions.json'), artifacts.decisions);
  await require('./config-env.js').upsertEnvFile(path.join(projectDir, 'config', 'wix.env'), { [ENV_KEY]: answer });
  return answer;
}

// The durable request a supervised run raises for an unanswered existing site.
function notificationMuteRequestInput() {
  return {
    kind: 'question',
    stage: 'intake',
    title: 'Mute notifications on the existing site?',
    prompt: NOTIFICATION_MUTE_QUESTION.question,
    response: { mode: 'choice', required: true },
    choices: NOTIFICATION_MUTE_QUESTION.choices.map((choice) => ({ ...choice })),
    effect: { kind: 'decision', key: DECISION_KEY, choices: { on: 'on', off: 'off' } },
  };
}

function isValidNotificationMuteEffect(effect, choices) {
  if (!effect || effect.kind !== 'decision' || effect.key !== DECISION_KEY) return false;
  const entries = Object.entries(effect.choices || {});
  return entries.length === ANSWERS.length && entries.every(([choice, value]) => choice === value && ANSWERS.includes(choice) && choices.some((item) => item.id === choice));
}

// Reuses the pending request, so a resumed run never asks twice.
async function ensureNotificationMuteRequest(projectDir) {
  const actions = require('./user-actions.js');
  for (const row of await actions.listUserActions(projectDir, { status: 'pending' })) {
    const request = await actions.readUserAction(projectDir, row.requestId);
    if (request.effect && request.effect.key === DECISION_KEY) return request;
  }
  return actions.createUserAction(projectDir, notificationMuteRequestInput());
}

module.exports = {
  ANSWERS,
  DECISION_KEY,
  ENV_KEY,
  MUTE_REQUIREMENT_ID,
  NOTIFICATION_MUTE_QUESTION,
  completionReportMute,
  ensureNotificationMuteRequest,
  isValidNotificationMuteEffect,
  notificationMuteRequestInput,
  recordNotificationMute,
  mutedRecorded,
  readNotificationMute,
  resolveNotificationMute,
  setupPlanMuteMismatch,
};
