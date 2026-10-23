'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ledger = require('./blog-post-build-ledger');

const REPORT = 'blog-import-report.json';
const SPOT_CHECK_ACTION = Object.freeze({
  code: 'blog-verification-spot-check', severity: 'medium', entity: 'blog-posts',
  action: 'Cutover Operator: open these posts in preview and check them; Import Operator records the result (prompt 10)',
  deadlineReason: 'before go-live: the run did not fetch these pages',
});

function atomicJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, `${JSON.stringify(data, null, 2)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function address(post) { return post.phase?.publishedPath || post.phase?.expectedPath || null; }
function pendingMediaDetails(projectDir) {
  const file = path.join(ledger.stateDir(projectDir), 'pending-blog-media.ndjson');
  if (!fs.existsSync(file)) return new Map();
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const details = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    let row;
    try { row = JSON.parse(lines[i]); }
    catch (error) {
      if (i === lines.length - 1 && !text.endsWith('\n')) break;
      throw new Error(`pending-blog-media line ${i + 1}: ${error.message}`);
    }
    if (!row.sourceStableKey) continue;
    if (!details.has(row.sourceStableKey)) details.set(row.sourceStableKey, new Map());
    const media = details.get(row.sourceStableKey);
    if (row.outcome === 'resolved') { media.clear(); continue; }
    if (row.mediaKey) media.set(row.mediaKey, row);
  }
  return new Map([...details].map(([key, rows]) => [key, [...rows.values()]
    .filter(row => row.outcome !== 'ready').map(row => ({ mediaKey: row.mediaKey, kind: row.kind,
      outcome: row.outcome, reason: row.reason || null, fileId: row.fileId || null }))]));
}
function blogSpotCheckOperatorAction(coverage) {
  if (!coverage || ['not-required', 'recorded'].includes(coverage.spotCheck.status)) return null;
  return { ...SPOT_CHECK_ACTION, affectedCount: coverage.requiredCount };
}
function verificationCoverage(state) {
  const verified = [...state.posts.values()].filter(post => post.phase?.phase === 'verified' && address(post));
  const sampled = verified.filter(post => post.snapshots.verify?.sampled === true);
  const unsampled = verified.filter(post => post.snapshots.verify?.sampled !== true);
  const pairs = unsampled.map(post => [post.sourceStableKey, address(post)]).sort((a, b) => a[0].localeCompare(b[0]));
  const coverageVersion = ledger.sha(pairs);
  const sampledAddresses = sampled.map(address).sort();
  const unsampledAddresses = unsampled.map(address).sort();
  const requiredCount = Math.min(3, unsampled.length);
  const last = state.spotCheck;
  let status = 'required';
  if (!unsampled.length) status = 'not-required';
  else if (last && last.coverageVersion !== coverageVersion) status = 'stale';
  else if (last?.posts?.some(post => post.result === 'fail')) status = 'failed';
  else if (last && last.posts.length >= requiredCount) status = 'recorded';
  return { schema: 1, coverageVersion, sampled: sampled.length, total: verified.length,
    sampledAddresses, unsampledAddresses, requiredCount,
    spotCheck: { status, seq: last?.seq || null, checkedBy: last?.checkedBy || null,
      checkedAt: last?.checkedAt || null, recordedBy: last?.recordedBy || null,
      posts: last?.posts || [] } };
}
function action({ code, severity, entity, affectedCount, role, prompt, impact, closure, records }) {
  return { code, severity, entity, affectedCount, role, prompt, impact, closure, records,
    action: `${role}: use blog report prompt ${prompt}; closure: ${closure}`,
    deadlineReason: severity === 'critical' ? `immediately: ${impact}` : `before go-live: ${impact}` };
}
function rebuildBlogReport(projectDir) {
  const state = ledger.fold(ledger.readRows(projectDir));
  const mediaDetails = pendingMediaDetails(projectDir);
  const held = [], pending = [], verificationFailures = [], containmentUrgent = [], containmentRebuild = [], adoptionAmbiguous = [];
  const addresses = [];
  let publishedPostReads = 0;
  let livePagesFetched = 0;
  for (const post of state.posts.values()) {
    const phase = post.phase;
    if (!phase) continue;
    const lastContainment = [...post.rows].reverse().find(row => row.phase === 'contained');
    const base = { sourceStableKey: post.sourceStableKey, draftId: phase.draftId,
      postId: phase.postId, reason: phase.reason, expectedPath: phase.expectedPath,
      publishedPath: phase.publishedPath, phase: phase.phase,
      ...(lastContainment ? { exposedFrom: lastContainment.exposedFrom,
        containedAt: lastContainment.containedAt } : {}) };
    if (address(post)) addresses.push({ sourceStableKey: post.sourceStableKey, address: address(post), phase: phase.phase });
    if (phase.phase === 'media-pending') pending.push({ ...base, media: mediaDetails.get(post.sourceStableKey) || [] });
    if (phase.phase === 'held' && ['adoption-ambiguous', 'legacy-mismatch', 'create-projection-mismatch'].includes(phase.reason)) {
      adoptionAmbiguous.push({ ...base, candidates: phase.candidates || [] });
    } else if (['held', 'contained'].includes(phase.phase)) held.push({ ...base,
      openFindings: post.openFindings['leftover-set'] || [] });
    if (phase.phase === 'verify-failed') verificationFailures.push({ ...base,
      openFindings: post.openFindings.verify || [] });
    if (post.containmentOpen && phase.phase === 'contain-failed') {
      (phase.reason === 'delete-failed' ? containmentUrgent : containmentRebuild).push(base);
    }
    publishedPostReads += post.snapshots.verify ? 1 : 0;
    livePagesFetched += post.snapshots.verify?.sampled ? 1 : 0;
  }
  const extras = [...state.duplicates.values()].filter(pair => !pair.closed).map(pair => ({
    sourceStableKey: pair.sourceStableKey, recordedDraftId: pair.recordedDraftId,
    extraDraftId: pair.extraDraftId, evidence: pair.evidence,
    status: !pair.evidence ? 'evidence-pending'
      : pair.evidence.status === 'consistent' && pair.confirmation ? 'ownership-confirmed'
        : 'owner-confirmation-needed',
    ownershipConfirmedBy: pair.confirmation?.chosenBy || null,
  }));
  const coverage = verificationCoverage(state);
  const operatorActions = [];
  if (held.length) operatorActions.push(action({ code: 'blog-held-posts', severity: 'high', entity: 'blog-posts',
    affectedCount: held.length, role: 'Import Operator', prompt: 2, impact: 'Posts remain unpublished',
    closure: 'empty leftover-set, then published and verified', records: held }));
  if (adoptionAmbiguous.length) operatorActions.push({ code: 'blog-adoption-ambiguous',
    severity: 'high', entity: 'blog-posts', affectedCount: adoptionAmbiguous.length,
    role: 'Import Operator', prompt: null,
    impact: 'A candidate draft could belong to another post or person; no write was made',
    action: 'Requires Import Operator: stop the blog step and inspect the listed draft ids, source post, and ledger identity evidence. Resolve the identity conflict with a reviewed recovery plan before any adoption, create, or deletion.',
    deadlineReason: 'before go-live: the post remains unpublished or unverified',
    closure: 'documented identity resolution and a later verified ledger row', records: adoptionAmbiguous });
  if (pending.length) operatorActions.push(action({ code: 'blog-pending-media', severity: 'high', entity: 'blog-posts',
    affectedCount: pending.length, role: 'Import Operator', prompt: 3,
    impact: 'Media is unresolved; new posts are held and existing crosswalk posts may already be live',
    closure: 'media ready, then published and verified', records: pending }));
  if (verificationFailures.length) operatorActions.push(action({ code: 'blog-verification-failed', severity: 'high', entity: 'blog-posts',
    affectedCount: verificationFailures.length, role: 'Import Operator', prompt: 4,
    impact: 'Published posts have failed checks', closure: 'reverified or accepted', records: verificationFailures }));
  if (containmentUrgent.length) operatorActions.push(action({ code: 'blog-may-still-be-live', severity: 'critical', entity: 'blog-posts',
    affectedCount: containmentUrgent.length, role: 'Cutover Operator; Requires Import Operator', prompt: 5,
    impact: 'A post that failed a blocking check may still be live', closure: 'not-found read, then contained', records: containmentUrgent }));
  if (containmentRebuild.length) operatorActions.push(action({ code: 'blog-rebuild-draft', severity: 'high', entity: 'blog-posts',
    affectedCount: containmentRebuild.length, role: 'Import Operator', prompt: 6,
    impact: 'Posts are off site and lack a draft', closure: 'contained with draft id, then verified', records: containmentRebuild }));
  for (const status of ['evidence-pending', 'owner-confirmation-needed', 'ownership-confirmed']) {
    const records = extras.filter(extra => extra.status === status);
    if (records.length) operatorActions.push(action({ code: `blog-extra-draft-${status}`, severity: 'high', entity: 'blog-posts',
      affectedCount: records.length, role: status === 'ownership-confirmed' ? 'Cutover Operator; Requires Import Operator' : 'Import Operator',
      prompt: status === 'evidence-pending' ? 9 : status === 'ownership-confirmed' ? 7 : 8,
      impact: 'An extra unpublished draft may belong to someone else',
      closure: 'provenance, kept, not-importer, or confirmed choice with re-test', records }));
  }
  const spot = blogSpotCheckOperatorAction(coverage);
  if (spot) operatorActions.push({ ...spot, role: 'Cutover Operator; Requires Import Operator', prompt: 10,
    records: coverage.unsampledAddresses });
  const report = { schema: 1, ledger: path.relative(projectDir, ledger.ledgerPath(projectDir)),
    totals: { posts: state.posts.size, publishedPostReads, livePagesFetched },
    addresses: addresses.sort((a, b) => a.sourceStableKey.localeCompare(b.sourceStableKey)),
    held, adoptionAmbiguous, pending, verificationFailures, containmentUrgent, containmentRebuild, extraDrafts: extras,
    verificationCoverage: coverage, operatorActions };
  atomicJson(path.join(ledger.stateDir(projectDir), REPORT), report);
  return report;
}

async function refreshBlogHandoff(projectDir) {
  const report = rebuildBlogReport(projectDir);
  const completion = require('../../../lib/completion-report');
  const file = path.join(projectDir, completion.COMPLETION_REPORT_FILE);
  if (!fs.existsSync(file)) return { report, status: 'completion-report-missing' };
  const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  const actions = (existing.operatorActions || []).filter(row => row.code !== SPOT_CHECK_ACTION.code);
  const spot = blogSpotCheckOperatorAction(report.verificationCoverage);
  if (spot) actions.push(spot);
  const normalized = actions.map(completion.normalizeOperatorAction);
  const updated = { ...existing, operatorActions: normalized };
  atomicJson(file, updated);
  const summaryFile = path.join(projectDir, completion.COMPLETION_SUMMARY_FILE);
  fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
  fs.writeFileSync(summaryFile, completion.renderCompletionSummary(updated));
  const { generatePostExecutionHandoff } = require('../../../lib/website-handoff');
  const handoff = await generatePostExecutionHandoff(projectDir, { appendLog: false });
  return { report, status: 'refreshed', handoff };
}

function recordBlogSpotCheck(projectDir, coverageVersion, posts, checkedBy, checkedAt, recordedBy, note) {
  return ledger.withLock(projectDir, async () => {
    const report = (await refreshBlogHandoff(projectDir)).report;
    const coverage = report.verificationCoverage;
    if (coverageVersion !== coverage.coverageVersion) throw new Error('spot-check coverageVersion is stale');
    if (!String(checkedBy || '').trim() || !String(recordedBy || '').trim()) throw new Error('checkedBy and recordedBy are required');
    if (!checkedAt || Number.isNaN(Date.parse(checkedAt))) throw new Error('checkedAt must be a date');
    if (!Array.isArray(posts) || posts.length < coverage.requiredCount) throw new Error(`at least ${coverage.requiredCount} unsampled posts required`);
    const allowed = new Set(coverage.unsampledAddresses);
    const seen = new Set();
    for (const post of posts) {
      if (!allowed.has(post.address) || seen.has(post.address)) throw new Error(`sampled, unverified, or duplicate address: ${post.address}`);
      if (!['pass', 'fail'].includes(post.result)) throw new Error('spot-check result must be pass or fail');
      if (!String(post.note || '').trim()) throw new Error('spot-check observation note is required');
      seen.add(post.address);
    }
    const byAddress = new Map(report.addresses.map(row => [row.address, row.sourceStableKey]));
    const row = ledger.appendRow(projectDir, { kind: 'spot-check', coverageVersion,
      posts: posts.map(post => ({ sourceStableKey: byAddress.get(post.address), ...post })),
      checkedBy: checkedBy.trim(), checkedAt, recordedBy: recordedBy.trim(), note });
    return { row, ...(await refreshBlogHandoff(projectDir)) };
  });
}

function acceptBlogFinding(projectDir, sourceStableKey, snapshotKind, findingKey, note, acceptedBy) {
  return ledger.withLock(projectDir, async () => {
    if (!String(acceptedBy || '').trim() || !String(note || '').trim()) throw new Error('acceptance needs a person and note');
    const state = ledger.fold(ledger.readRows(projectDir));
    const post = state.posts.get(sourceStableKey);
    const snapshot = post?.snapshots[snapshotKind];
    const finding = snapshot?.findings.find(item => item.findingKey === findingKey);
    if (!finding || !post.openFindings[snapshotKind].some(item => item.findingKey === findingKey)) {
      throw new Error('findingKey is not open in the current snapshot');
    }
    if (finding.blocking) throw new Error('a blocking finding cannot be accepted');
    const row = ledger.appendRow(projectDir, { kind: 'accepted', sourceStableKey,
      snapshotKind, findingKey, snapshotSeq: snapshot.seq, note, acceptedBy: acceptedBy.trim() });
    const after = ledger.fold(ledger.readRows(projectDir)).posts.get(sourceStableKey);
    if (after.phase?.phase === 'verify-failed' && Object.values(after.openFindings).every(items => !items.length)) {
      ledger.appendRow(projectDir, { kind: 'phase', sourceStableKey, phase: 'verified',
        draftId: after.phase.draftId, postId: after.phase.postId,
        publishedPath: after.phase.publishedPath, via: 'accepted' });
    }
    return { row, ...(await refreshBlogHandoff(projectDir)) };
  });
}

module.exports = { REPORT, SPOT_CHECK_ACTION, verificationCoverage,
  blogSpotCheckOperatorAction, rebuildBlogReport, refreshBlogHandoff,
  recordBlogSpotCheck, acceptBlogFinding };
