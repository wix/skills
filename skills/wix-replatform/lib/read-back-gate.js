'use strict';

const {
  AsyncLocalStorage
} = require('node:async_hooks');
const path = require('node:path');
const state = require('./read-back-state');
const C = require('./read-back-contract');
const {
  compareEntity,
  memberProjection
} = require('./read-back-comparison');
const {
  ReadBackReads
} = require('./read-back-reads');
const verified = require('./write-verification');
const store = require('./write-verification-state');
const {
  hashArtifact
} = require('./artifact-freshness');
const writers = require('../resources/rp-target-wix/lib/wix-writers');
const wixAuth = require('./wix-auth.js');
const {
  deriveImportedOrderId
} = require('../resources/rp-target-wix/lib/order-history');
const {
  findMatching
} = require('../resources/rp-target-wix/lib/contact-import');
const approval = require('./read-back-approval');
const API = 'https://www.wixapis.com';
const readSessions = new Map();
const writeContexts = new AsyncLocalStorage();
const writeTrackers = new WeakMap();

// The generated wrapper can do reads before it attempts its mutating request. Track only
// non-read sends so a writer exception is classified as not-sent only when this invocation
// provably made no mutating request. AsyncLocalStorage keeps concurrent batch writers separate.
function installWriteTracker(wix) {
  if (!wix || !['object', 'function'].includes(typeof wix) || typeof wix.send !== 'function') return null;
  const active = writeTrackers.get(wix);
  if (active) {
    active.references++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active.references--;
      if (!active.references) {
        writeTrackers.delete(wix);
        if (wix.send === active.trackedSend) wix.send = active.original;
      }
    };
  }
  const original = wix.send;
  const tracker = {
    original,
    references: 1,
    trackedSend: null
  };
  tracker.trackedSend = function trackedSend(request, ...args) {
    const context = writeContexts.getStore();
    // The generated writers keep their `{ read: true }` mark in a private WeakMap (`requestMark`), not on
    // the request, so ask the writers; `request.read` still counts for hand-built requests.
    if (context && !(request?.read || writers.requestMark?.(request)?.read)) context.requestSent = true;
    return original.call(this, request, ...args);
  };
  try {
    wix.send = tracker.trackedSend;
  } catch {
    return null;
  }
  writeTrackers.set(wix, tracker);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    tracker.references--;
    if (!tracker.references) {
      writeTrackers.delete(wix);
      if (wix.send === tracker.trackedSend) wix.send = original;
    }
  };
}
function sharedReads(projectDir, runId, wix) {
  const key = `${path.resolve(projectDir)}\0${runId}`;
  if (!readSessions.has(key)) readSessions.set(key, new ReadBackReads(wix));
  return readSessions.get(key);
}
// Every shape a writer may use to report the target it wrote. The success path and the
// deferral check share it, so a deferral can never hide an id the success path would accept.
function writtenTargetId(entity, written) {
  return written?.targetId || written?.id || written?.[`${entity}Id`] || written?.[entity]?.id;
}
function problem(reason) {
  return Object.assign(new Error(reason), {
    code: reason
  });
}
// Writer guards approved elsewhere that remove a value before sending (the member
// phone-collision drop). Only these exact finding -> path pairs can exempt a path, and only when
// the writer itself reported the finding; a missing target field never implies a guard.
const WRITER_GUARDS = {
  member: [{
    path: 'member.contact.phones[]',
    applies: f => f?.code === 'member-phone-collision-dropped' && f.phoneDropped === true,
    strip: body => {
      delete body.member?.contact?.phones;
    }
  }]
};
function guardPathsFrom(entity, findings) {
  return (WRITER_GUARDS[entity] || []).filter(g => (findings || []).some(g.applies)).map(g => g.path);
}
function applyGuards(entity, expected, paths) {
  const guards = (WRITER_GUARDS[entity] || []).filter(g => (paths || []).includes(g.path));
  if (!guards.length) return expected;
  const body = structuredClone(expected);
  for (const g of guards) g.strip(body);
  return body;
}
function declaration(entity, {
  verificationKind,
  reason
} = {}) {
  if (Object.hasOwn(C.DOMAINS, entity)) return {
    entity,
    gated: true
  };
  if (!verificationKind || !reason?.trim()) throw new Error('Non-gated entities must declare verification and reason');
  return {
    entity,
    gated: false,
    verificationKind,
    reason
  };
}
class ReadBackGate {
  constructor({
    projectDir,
    runId,
    entity,
    siteId,
    wix,
    buildWrite,
    write,
    repair,
    sourceSiteHost,
    marker,
    variants = [],
    reads,
    read,
    lookup,
    now = () => new Date().toISOString(),
    identity
  } = {}) {
    if (!projectDir || typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(runId) || ['constructor', 'prototype', '__proto__'].includes(runId) || !siteId || typeof buildWrite !== 'function' || typeof write !== 'function') throw new Error('Read-back gate requires project, run, site, builder and writer');
    C.entityKey(entity);
    Object.assign(this, {
      projectDir,
      runId,
      entity,
      siteId,
      wix,
      buildWrite,
      write,
      repair,
      sourceSiteHost,
      marker,
      variants,
      now,
      identity
    });
    this.reads = reads || sharedReads(projectDir, runId, wix);
    this.startedAt = this.reads.now();
    this.preparationMs = 0;
    this.writeMs = 0;
    this.read = read || (id => this.readTarget(id));
    this.lookup = lookup || ((record, expected) => this.lookupTarget(record, expected));
  }
  async mutate(fn) {
    return state.update(this.projectDir, g => {
      g.runs[this.runId] ||= {
        entities: {}
      };
      g.runs[this.runId].entities[this.entity] ||= {
        status: 'stopped',
        canaries: [],
        settlements: [],
        approvedOmissions: []
      };
      const item = g.runs[this.runId].entities[this.entity],
        result = fn(g, item);
      item.retryStats = {
        ...this.reads.stats,
        remainingMs: this.reads.remaining()
      };
      item.timing = {
        elapsedMs: Math.max(0, this.reads.now() - this.startedAt),
        preparationMs: this.preparationMs,
        writeMs: this.writeMs,
        activeReadMs: Object.entries(this.reads.stats).filter(([key]) => key.endsWith('Ms')).reduce((n, [, value]) => n + value, 0)
      };
      return result;
    });
  }
  async item() {
    return (await state.load(this.projectDir)).runs[this.runId]?.entities?.[this.entity];
  }
  async prepare(inv, {
    ceiling,
    preparationMs = inv?.preparationMs || 0
  } = {}) {
    const preparingAt = this.reads.now();
    await approval.recoverAcknowledgements(this.projectDir, this.identity ? {
      identity: this.identity
    } : {});
    this.validated = await C.validate(this.projectDir, this.entity, {
      inv
    });
    if (!this.validated.valid) {
      await this.stop('mapping-validation-failed');
      throw Object.assign(problem('mapping-validation-failed'), {
        errors: this.validated.errors
      });
    }
    const decisions = await state.readJson(this.projectDir, 'orchestration/decisions.json', {}),
      chosen = decisions[`readBackCanaryCeiling.${this.entity}`] || decisions.readBackCanaryCeiling?.[this.entity] || decisions.decisions?.[`readBackCanaryCeiling.${this.entity}`];
    if (ceiling !== undefined) throw new Error('Canary ceiling must come from recorded user decision, not the caller');
    if (chosen && (chosen.source !== 'user' || !Number.isInteger(chosen.value))) throw problem('canary-ceiling-not-user-recorded');
    const history = await state.load(this.projectDir);
    // Only a prepared entry (schedule and bindings) is a previous run to continue. An unprepared
    // one (completion's `gate-not-run` placeholder, a validation stop) is taken over by this run;
    // it stays blocking until then, and this run's own gate status replaces it.
    const others = Object.entries(history.runs).filter(([id, run]) => id !== this.runId && run.entities?.[this.entity] && !run.entities[this.entity].supersededBy);
    const preparedEntry = e => Boolean(e.schedule && e.bindingDigests);
    const previousRun = [...others].reverse().find(([, run]) => preparedEntry(run.entities[this.entity]));
    const unprepared = others.filter(([, run]) => !preparedEntry(run.entities[this.entity])).map(([id]) => id);
    const own = await this.item();
    const existing = own?.schedule ? own : previousRun?.[1].entities[this.entity];
    // A skip belongs to the run that made it: a parent may have landed since, so a later run offers
    // the record again (and skips it again if its parent is still final). This run's own skips hold.
    const priorSkips = existing?.skippedCanaries || [], keptSkips = priorSkips.filter(r => r.runId === this.runId);
    const schedule = C.cover(inv, {
      ceiling: chosen?.value || 10,
      existing: (existing?.canaries || []).map(r => r.sourceId),
      exclude: keptSkips.map(r => r.sourceId)
    });
    this.inventory = inv;
    this.repairContractDigest = C.digest({
      bindings: this.validated.bindingDigests,
      code: hashArtifact(this.projectDir, 'src/import'),
      comparator: 1
    });
    this.preparationMs += preparationMs + Math.max(0, this.reads.now() - preparingAt);
    const approvedOmissionRows=this.validated.fieldContractVersion===1 ? require('./mapping-omission-approval').omissions(this.validated.decision) : null;
    await this.mutate((g, item) => {
      if (!own?.schedule && existing) {
        Object.assign(item, structuredClone(existing));
        delete item.supersededBy;
        if (previousRun) g.runs[previousRun[0]].entities[this.entity].supersededBy = this.runId;
      }
      for (const id of unprepared) g.runs[id].entities[this.entity].supersededBy = this.runId;
      if (existing && C.digest(existing.bindingDigests) !== C.digest(this.validated.bindingDigests)) {
        item.approvedOmissions = [];
        delete item.pendingAcknowledgementRequest;
      }
      item.paths ||= {};
      item.paths.notExercised = this.validated.contract.intendedFields.filter(f => !(this.validated.decision.fieldDispositions || []).some(d => ['notMigrated','deferred'].includes(d.status) && (d.path || d.targetPath) === f.targetPath)).filter(f => !Object.keys(inv.writePaths).some(p => p === f.targetPath || p.startsWith(f.targetPath + '.') || p.startsWith(f.targetPath + '[]'))).map(f => f.targetPath);
      item.pendingFields = (this.validated.decision.fieldDispositions || []).filter(d=>d.status==='deferred');
      // The schedule is the fresh one, not a persisted one that excluded a record skipped by an earlier run.
      const retriedSkips = priorSkips.length > keptSkips.length;
      if (keptSkips.length) item.skippedCanaries = structuredClone(keptSkips); else delete item.skippedCanaries;
      item.schedule = existing?.schedule?.universeDigest === schedule.universeDigest && !retriedSkips ? existing.schedule : schedule;
      item.status = 'stopped';
      item.stopReason = schedule.status === 'covered' ? 'canaries-pending' : schedule.status;
      item.retryStats = this.reads.stats;
      item.invocationStartedAt = this.now();
      item.bindingDigests = this.validated.bindingDigests;
      if (inv.heldRecords) item.heldRecords = structuredClone(inv.heldRecords);else delete item.heldRecords;
      if (!inv.records.length) item.endOfRunVerified = true;
      if (!item.approvedOmissions.length) item.approvedOmissions = (this.validated.decision.fieldDispositions || []).filter(d => d.status === 'notMigrated' &&
        (!approvedOmissionRows || approvedOmissionRows.some(o=>o.kind===d.kind && o.path===d.path && o.writeOperation===(d.writeOperation || null)))).map(d => ({
        path: d.path || d.sourcePath || d.targetPath,
        kind: d.kind || 'source',
        recordCount: d.affectedScope ? d.affectedScope.count : inv.sourcePaths[d.path || d.sourcePath] || inv.records.length,
        ...(d.affectedScope ? {affectedScope:d.affectedScope,writeOperation:d.writeOperation || null} : {}),
        approvedBy: this.validated.approval?.approvedBy || null
      }));
    });
    if (schedule.status !== 'covered') throw Object.assign(problem(schedule.status), {
      uncoveredPaths: schedule.uncoveredPaths
    });
    return schedule;
  }
  async protect(sourceId, change) {
    return state.locked(this.projectDir, async () => {
      const s = await store.load(this.projectDir, this.siteId),
        key = `read-back:${this.entity}:${sourceId}`;
      s.rows[key] = {
        ...(s.rows[key] || {}),
        sourceKey: key,
        kind: 'read-back-gate',
        entity: this.entity,
        sourceId,
        runId: this.runId,
        ...change
      };
      await store.checkpoint(this.projectDir, s, [{
        sourceKey: key
      }]);
      return s.rows[key];
    });
  }
  async protected(sourceId) {
    const s = await store.load(this.projectDir, this.siteId);
    return s.rows[`read-back:${this.entity}:${sourceId}`];
  }
  async stop(reason) {
    await this.mutate((g, item) => {
      if (reason === 'read-budget-exhausted') for (const e of Object.values(g.runs[this.runId].entities)) {
        if (e.status !== 'passed') {
          e.status = 'unknown';
          e.stopReason = reason;
        }
      }
      item.status = reason.includes('unknown') || /budget|settlement|unavailable/.test(reason) ? 'unknown' : 'stopped';
      item.stopReason = reason;
      item.retryStats = {
        ...this.reads.stats,
        remainingMs: this.reads.remaining()
      };
    });
  }
  async readTarget(id) {
    const w = this.reads.wix;
    if (this.entity === 'product') return writers.getStoresProductForVerification(w, id);
    if (this.entity === 'contact') return (await w.send(writers.buildGetContactRequest(id))).contact;
    if (this.entity === 'order') return (await w.send({
      method: 'GET',
      url: `${API}/ecom/v1/orders/${encodeURIComponent(id)}`
    })).order;
    const m = (await w.send(writers.buildGetMemberRequest(id))).member;
    if (!m?.contactId) throw problem('member-contact-id-unknown');
    const c = (await w.send(writers.buildGetContactRequest(m.contactId))).contact;
    if (c?.id !== m.contactId) throw problem('member-contact-identity-unknown');
    return {
      member: m,
      contact: c
    };
  }
  async lookupTarget(record, body) {
    const e = body[this.entity] || body,
      w = this.reads.wix;
    if (this.entity === 'order') {
      const id = deriveImportedOrderId({
        sourceSiteHost: this.sourceSiteHost,
        sourceId: String(record.id)
      });
      try {
        return [await this.readTarget(id)];
      } catch (err) {
        if (err.status === 404 && err.outcomeKnown) return [];
        throw err;
      }
    }
    if (this.entity === 'contact') return findMatching(w, e);
    if (this.entity === 'member') return (await writers.queryMembersByLoginEmail(w, e.loginEmail)).filter(m => verified.email(m.loginEmail) === verified.email(e.loginEmail));
    const products = await writers.queryAllStoresProducts(w),
      marker = typeof this.marker === 'function' ? this.marker(record, body) : this.marker;
    if (!marker?.path) throw problem('product-marker-required');
    const matches = products.filter(p => C.valuesAt(p, marker.path).some(v => v === marker.value));
    // A product that was on the store before this import is never this record's write.
    const baseline = require('./catalog-baseline'),
      held = matches.find(p => baseline.protectedIds(this.projectDir).products.has(p.id));
    if (held) {
      baseline.recordCollision(this.projectDir, { entity: 'stores/product', sourceKey: `read-back:${this.entity}:${record.id}`, targetId: held.id, slug: held.slug ?? null });
      throw problem('target-baseline-collision');
    }
    return matches;
  }
  checkIdentity(expected, actual, id) {
    const e = expected[this.entity] || expected,
      a = actual[this.entity] || actual;
    if (!id || a?.id !== id || a?._dryRunPlaceholder) throw problem('identity-conflict');
    if (this.entity === 'contact' && !verified.contactIdentity(e, a, id).verified) throw problem('identity-conflict');
    if (this.entity === 'product' && !verified.verifyProduct({
      id
    }, a, id, {
      marker: typeof this.marker === 'function' ? this.marker(this.activeRecord, expected) : this.marker,
      variants: typeof this.variants === 'function' ? this.variants(this.activeRecord, expected) : this.variants
    }).verified) throw problem('identity-conflict');
    if (this.entity === 'member' && (verified.email(e.loginEmail) !== verified.email(a.loginEmail) || !a.contactId || actual.contact?.id !== a.contactId)) throw problem('member-contact-identity-unknown');
    if (this.entity === 'order' && (a.number !== e.number || id !== deriveImportedOrderId({
      sourceSiteHost: this.sourceSiteHost,
      sourceId: String(this.activeSourceId)
    }))) throw problem('identity-conflict');
  }
  assertApplicability(record, expected, guarded, options = {}) {
    if (C.builderHold(expected)) throw problem('builder-held-record');
    const judged = C.outputApplicability(this.validated.rows, record, expected, { guarded: guarded || [], ...options });
    if (judged.missing.length) throw problem('builder-missing-intended-field');
    if (judged.unexpected.length) throw problem('builder-emitted-inapplicable-field');
  }
  async observe(record, sourceId, targetId, expected) {
    // Read-back compares only applicable outputs: an expected body carrying a non-applicable (or
    // missing a declared applicable) output is refused before any read.
    this.assertApplicability(record, expected, (WRITER_GUARDS[this.entity] || []).map(g => g.path), { declaredOnly: true });
    // No target id means nothing was written to read: refused before any request (a read of
    // `.../undefined` only spends the read budget on 404s).
    if (noTarget(targetId)) throw Object.assign(problem('target-id-missing'), { requestSent: false });
    this.activeSourceId = sourceId;
    this.activeRecord = record;
    let actual = await this.read(targetId, this.reads.wix);
    this.checkIdentity(expected, actual, targetId);
    let result = compareEntity(this.entity, expected, actual),
      media = result.checks.filter(c => !c.matches && c.writePath.startsWith('product.media.'));
    if (media.length) {
      let settled = false,
        reason = 'media-settlement-exhausted';
      try {
        await this.reads.settle();
        actual = await this.read(targetId, this.reads.wix);
        this.checkIdentity(expected, actual, targetId);
        result = compareEntity(this.entity, expected, actual);
        settled = !result.checks.some(c => !c.matches && c.writePath.startsWith('product.media.'));
      } catch (e) {
        if (wixAuth.isRunInterruption(e)) throw e;
        reason = e.code || 'media-settlement-exhausted';
      }
      await this.mutate((g, item) => {
        for (const check of media) {
          const row = this.rowFor(check.writePath),
            entry = {
              entity: this.entity,
              sourceId,
              targetId,
              readPath: check.readPath,
              writePath: check.writePath,
              sourcePaths: row?.sourcePaths || [],
              intendedTargetPath: row?.writePath || check.writePath,
              bindingSetDigest: C.digest(this.validated.bindingDigests),
              policy: 'product-media-read-after-60s',
              status: settled ? 'passed' : 'unknown',
              reads: 2,
              waitedMs: this.reads.stats.settlementMs,
              reason: settled ? null : reason
            };
          item.settlements = item.settlements.filter(s => !(s.sourceId === sourceId && s.writePath === check.writePath));
          item.settlements.push(entry);
        }
      });
      if (!settled) {
        await this.recordLosses(sourceId, result.checks.filter(c => !c.writePath.startsWith('product.media.')));
        await this.stop(reason);
        return {
          verified: false,
          unknown: true,
          actual,
          checks: result.checks
        };
      }
    }
    await this.recordLosses(sourceId, result.checks);
    // A record held earlier as a baseline collision that now verifies is no longer one.
    if (result.verified && this.entity === 'product') require('./catalog-baseline').clearCollision(this.projectDir, 'stores/product', `read-back:${this.entity}:${sourceId}`);
    if (!result.verified) await this.stop('field-mismatch');else await this.mutate((g, item) => {
      for (const s of item.settlements.filter(s => s.sourceId === sourceId)) s.status = 'passed';
      for (const loss of g.observedLosses) if (loss.entity === this.entity && result.checks.some(c => c.matches && c.writePath === loss.writePath)) loss.resolvedBy = {
        sourceId,
        targetId,
        at: this.now()
      };
    });
    return {
      ...result,
      actual
    };
  }
  rowFor(writePath) {
    const rows = this.validated.rows.filter(r => r.writePath === writePath || writePath.startsWith(`${r.writePath}.`) || writePath.startsWith(`${r.writePath}[]`) || r.writePath.startsWith(`${writePath}[]`)).sort((a, b) => b.writePath.length - a.writePath.length);
    return rows.length ? {
      ...rows[0],
      sourcePaths: [...new Set(rows.flatMap(r => r.sourcePaths || []))]
    } : null;
  }
  async recordLosses(sourceId, checks) {
    await this.mutate((g, item) => {
      for (const check of checks) {
        if (check.matches) continue;
        const row = this.rowFor(check.writePath);
        if (!g.observedLosses.some(l => l.entity === this.entity && l.writePath === check.writePath)) g.observedLosses.push({
          entity: this.entity,
          writePath: check.writePath,
          readPath: check.readPath,
          sourcePaths: row?.sourcePaths || [],
          intendedTargetPath: row?.writePath || check.writePath,
          kind: check.kind,
          firstSourceId: sourceId,
          bindingSetDigest: C.digest(this.validated.bindingDigests),
          observedAt: this.now()
        });
      }
      item.checks = checks.map(c => ({
        ...c
      }));
      for (const c of checks) {
        const key = c.kind === 'unverifiable' ? 'unverifiable' : c.matches ? 'verified' : c.kind;
        (item.paths ||= {})[key] ||= [];
        if (!item.paths[key].includes(c.writePath)) item.paths[key].push(c.writePath);
      }
    });
  }
  async timeWrite(write) {
    const started = this.reads.now();
    const context = {
      requestSent: false
    };
    try {
      const run = this.writeTracking ? writeContexts.run(context, write) : write();
      return await run;
    } catch (error) {
      // A generated writer may fail during readiness/reference validation before it reaches
      // Wix. The gate can safely settle that refusal only when its send tracker saw no
      // mutating request; preserve an explicit writer classification when one exists.
      if (this.writeTracking && !context.requestSent && error && typeof error === 'object' && error.requestSent === undefined) error.requestSent = false;
      throw error;
    } finally {
      this.writeMs += Math.max(0, this.reads.now() - started);
    }
  }
  async withWriteTracking(run) {
    const restore = installWriteTracker(this.wix);
    if (!restore) return run();
    this.writeTracking = true;
    try {
      return await run();
    } finally {
      this.writeTracking = false;
      restore();
    }
  }
  async executeCanaries(getRecord) {
    if (!this.validated?.valid) throw problem('gate-not-prepared');
    let item = await this.item();
    if (item.schedule.status !== 'covered') throw problem('coverage-exceeds-ceiling');
    for (const sourceId of item.schedule.canarySourceIds) {
      if (this.reads.remaining() <= 0) {
        await this.stop('read-budget-exhausted');
        return false;
      }
      const record = await getRecord(sourceId),
        prior = await this.protected(sourceId);
      let expected = await this.buildWrite(record),
        targetId = prior?.targetId,
        newWrite = false;
      // A previous attempt the client refused before sending left nothing on the site: write again.
      const notSent = prior?.outcome === 'not-sent' && !prior.targetId;
      await this.mutate((g, e) => {
        if (!e.canaries.some(c => c.sourceId === sourceId)) e.canaries.push({
          sourceId,
          targetId: prior?.targetId || null,
          marker: prior?.marker,
          outcome: prior?.outcome || 'pending',
          repairAttempts: prior?.repairAttempts || []
        });
      });
      expected = applyGuards(this.entity, expected, prior?.guardDroppedPaths);
      // Every applicable populated mapping must produce an expected target value, and an output whose
      // declared appliesWhen is false must be absent. The builder's own omission proves nothing.
      this.assertApplicability(record, expected, prior?.guardDroppedPaths);
      if (prior && !targetId && !notSent) {
        let found;
        try {
          found = await this.lookup(record, expected, this.reads.wix);
        } catch (e) {
          if (wixAuth.isRunInterruption(e)) throw e;
          await this.stop(e.code || 'unknown-write-lookup-failed');
          return false;
        }
        const matches = Array.isArray(found) ? found : found?.matches || [];
        if (matches.length !== 1) {
          await this.stop(matches.length > 1 ? 'identity-conflict' : 'unknown-write-no-match');
          return false;
        }
        targetId = matches[0].id;
        await this.protect(sourceId, {
          targetId,
          uncertain: false
        });
      }
      if (!prior || notSent) {
        await this.mutate((g, e) => {
          if (!e.canaries.some(c => c.sourceId === sourceId)) e.canaries.push({
            sourceId,
            targetId: null,
            outcome: 'pending',
            repairAttempts: []
          });
        });
        await this.mutate((g, e) => {
          e.attemptedPaths ||= [];
          for (const row of this.validated.rows) if (C.valuesAt(expected, row.writePath).some(C.populated) && !e.attemptedPaths.some(p => p.writePath === row.writePath)) e.attemptedPaths.push({
            entity: this.entity,
            sourceId,
            writePath: row.writePath,
            sourcePaths: row.sourcePaths,
            intendedTargetPath: row.writePath,
            bindingSetDigest: C.digest(this.validated.bindingDigests)
          });
        });
        await this.protect(sourceId, {
          expected,
          payloadDigest: C.digest(expected),
          contractDigest: this.repairContractDigest,
          sentAt: this.now(),
          outcome: 'pending',
          uncertain: true
        });
        try {
          const written = await this.timeWrite(() => this.write(record, expected));
          // The writer declined before sending (`{ deferred: true, reason }`, e.g. its dependency
          // gate deferred the record): nothing reached the site, so it is not a possible write.
          // Only the exact documented shape is trusted. Any id alias the success path accepts, or
          // any other key, means a write may exist: keep the protection (unknown outcome).
          if (written?.deferred === true) {
            if (writtenTargetId(this.entity, written)) throw problem('unknown-write-deferred-with-id');
            if (Object.keys(written).some(key => key !== 'deferred' && key !== 'reason')) throw problem('unknown-write-deferral-malformed');
            await this.protect(sourceId, {
              uncertain: false,
              sentAt: null,
              outcome: 'not-sent',
              notSentReason: typeof written.reason === 'string' && written.reason ? written.reason : 'write-deferred'
            });
            // Its own parent record is final for this run (dependency-parent-final): this record
            // cannot be a canary now. Another record covers its paths; it imports later with the
            // rest of the entity once its parent lands. Only a never-written canary is replaced.
            if (written.reason === 'dependency-parent-final' && !prior?.targetId && this.inventory) {
              let next;
              await this.mutate((g, e) => {
                e.skippedCanaries = [...(e.skippedCanaries || []).filter(row => row.sourceId !== sourceId), { sourceId, reason: written.reason, runId: this.runId }];
                e.canaries = e.canaries.filter(row => row.sourceId !== sourceId);
                next = C.cover(this.inventory, { ceiling: e.schedule.ceiling, existing: e.canaries.map(row => row.sourceId), exclude: e.skippedCanaries.map(row => row.sourceId) });
                e.schedule = next;
              });
              if (next.status !== 'covered') { await this.stop(next.status); return false; }
              return this.executeCanaries(getRecord);
            }
            await this.stop('canary-write-deferred');
            return false;
          }
          targetId = writtenTargetId(this.entity, written);
          const guarded = await this.recordGuard(sourceId, written?.findings);
          if (guarded.length) expected = applyGuards(this.entity, expected, guarded);
          if (!targetId) throw problem('unknown-write-no-confirmed-id');
          await this.protect(sourceId, {
            targetId,
            uncertain: false
          });
          newWrite = true;
        } catch (e) {
          if (wixAuth.isRunInterruption(e)) throw e;
          // Refused before sending (a capability or readiness refusal): the outcome is known, so
          // the record must not stay protected as possibly written.
          if (e?.requestSent === false && !targetId) await this.protect(sourceId, {
            uncertain: false,
            sentAt: null,
            outcome: 'not-sent',
            notSentReason: e.code || e.message
          });
          await this.stop(e.code || 'unknown-write-outcome');
          return false;
        }
      }
      let result;
      try {
        result = await this.observe(record, sourceId, targetId, expected);
      } catch (e) {
        if (wixAuth.isRunInterruption(e)) throw e;
        await this.stop(e.code || 'unknown-read');
        return false;
      }
      const actual = result.actual[this.entity] || result.actual,
        marker = actual.revision ?? actual.updatedDate;
      if (!result.verified && !result.unknown && prior) {
        const previous = (await this.item()).canaries.find(c => c.sourceId === sourceId),
          attempted = previous?.repairAttempts?.some(a => a.contractDigest === this.repairContractDigest);
        if (this.entity !== 'order' && this.repair && prior.contractDigest !== this.repairContractDigest && !attempted && previous?.marker !== undefined && previous.marker === marker) {
          await this.mutate((g, e) => {
            e.canaries.find(c => c.sourceId === sourceId).repairAttempts.push({
              contractDigest: this.repairContractDigest,
              markerBefore: marker,
              outcome: 'pending',
              at: this.now()
            });
          });
          await this.protect(sourceId, {
            repairAttempts: (await this.item()).canaries.find(c => c.sourceId === sourceId).repairAttempts
          });
          try {
            await this.timeWrite(() => this.repair({
              record,
              expected,
              targetId,
              marker
            }));
            result = await this.observe(record, sourceId, targetId, expected);
            newWrite = true;
          } catch (e) {
            if (wixAuth.isRunInterruption(e)) throw e;
            await this.stop(e.code || 'unknown-repair-outcome');
            return false;
          }
          await this.mutate((g, e) => {
            const c = e.canaries.find(c => c.sourceId === sourceId);
            c.repairAttempts.find(a => a.contractDigest === this.repairContractDigest).outcome = result.unknown ? 'unknown' : result.verified ? 'repaired' : 'still-mismatching';
          });
        } else await this.mutate((g, e) => {
          e.listed ||= [];
          e.listed.push({
            sourceId,
            targetId,
            reason: this.entity === 'order' ? 'order-not-rewritten' : attempted ? 'repair-already-attempted' : 'changed-since-write'
          });
        });
      }
      await this.protect(sourceId, {
        expected,
        targetId,
        ...(newWrite ? {
          contractDigest: this.repairContractDigest
        } : {}),
        outcome: result.verified ? 'verified' : result.unknown ? 'unknown' : 'mismatch',
        repairAttempts: (await this.item()).canaries.find(c => c.sourceId === sourceId).repairAttempts,
        ...(newWrite ? {
          marker: (result.actual[this.entity] || result.actual).revision ?? (result.actual[this.entity] || result.actual).updatedDate
        } : {})
      });
      await this.mutate((g, e) => {
        const c = e.canaries.find(c => c.sourceId === sourceId);
        c.targetId = targetId;
        c.outcome = result.verified ? 'verified' : result.unknown ? 'unknown' : 'mismatch';
        if (newWrite) {
          const v = result.actual[this.entity] || result.actual;
          c.marker = v.revision ?? v.updatedDate;
        }
        e.retryStats = {
          ...this.reads.stats,
          remainingMs: this.reads.remaining()
        };
      });
      if (!result.verified) return false;
    }
    if ((await this.item()).suspectInterval) {
      await this.stop('suspect-reconciliation-required');
      return false;
    }
    await this.mutate((g, e) => {
      e.status = 'passed';
      e.stopReason = null;
      e.listed = [];
      e.resumeAfter = e.schedule.canarySourceIds.at(-1) || null;
    });
    await approval.createAcknowledgement(this.projectDir, this.runId, this.entity);
    return true;
  }
  // Durably records an approved writer guard for one source record, from the findings the writer
  // returned for that record's write. Bulk imports call this after each write that returned
  // findings (only a recognized guard finding persists anything). Returns the guarded paths.
  async recordGuard(sourceId, findings) {
    const paths = guardPathsFrom(this.entity, findings);
    if (!paths.length) return [];
    sourceId = String(sourceId);
    const prior = await this.protected(sourceId);
    await this.protect(sourceId, {
      guardDroppedPaths: [...new Set([...(prior?.guardDroppedPaths || []), ...paths])]
    });
    await this.mutate((g, e) => {
      e.guardDropped ||= [];
      for (const p of paths) if (!e.guardDropped.some(d => d.sourceId === sourceId && d.path === p)) e.guardDropped.push({
        sourceId,
        path: p,
        kind: 'guard-dropped'
      });
      e.attemptedPaths = (e.attemptedPaths || []).filter(a => !(a.sourceId === sourceId && paths.includes(a.writePath)));
    });
    return paths;
  }
  // Expected body for a read-only check: rebuilt from the source record, minus only the paths a
  // recorded writer guard dropped for this record. Every other field stays loss-checked.
  async expectedFor(record, sourceId) {
    return applyGuards(this.entity, await this.buildWrite(record), (await this.protected(String(sourceId)))?.guardDroppedPaths);
  }
  async verifySample({
    record,
    sourceId,
    targetId,
    index,
    isLast = false,
    findings
  }) {
    if (!Number.isInteger(index) || index < 1) throw new Error('Sample index is one-based stable source order');
    if (findings) await this.recordGuard(sourceId, findings);
    if (index % 200 !== 0 && !isLast) return {
      skipped: true
    };
    const expected = await this.expectedFor(record, sourceId);
    let result;
    try {
      result = await this.observe(record, String(sourceId), targetId, expected);
    } catch (e) {
      if (wixAuth.isRunInterruption(e)) throw e;
      result = {
        verified: false,
        unknown: true,
        reason: e.code || 'unknown-read'
      };
      await this.stop(result.reason);
    }
    await this.protect(String(sourceId), {
      expected,
      actual: result.actual || null,
      targetId,
      verificationType: 'sample',
      outcome: result.verified ? 'verified' : 'unknown'
    });
    await this.mutate((g, e) => {
      if (isLast) e.endOfRunVerified = result.verified === true;
      if (result.verified) {
        e.lastGoodIndex = index;
        e.lastGoodSourceId = String(sourceId);
      } else e.suspectInterval = {
        fromIndex: (e.lastGoodIndex || 0) + 1,
        toIndex: index,
        count: index - (e.lastGoodIndex || 0),
        sourceIds: this.validated.inventory.records.slice(e.lastGoodIndex || 0, index).filter(r => !r.held).map(r => r.sourceId)
      };
    });
    return result;
  }
  async reconcileInterval(getRecord, targetIdFor) {
    const item = await this.item();
    // The interval names every non-held record between the last good sample and the failed one,
    // landed or not. Only a record with a target can have been written while the sample was
    // failing; it is read back and compared. A record with no target is listed, never read --
    // unless this gate holds it as a possibly-sent write, which stops the reconcile instead.
    const noTargetSourceIds = [];
    for (const id of item.suspectInterval?.sourceIds || []) {
      const targetId = await targetIdFor(id);
      if (noTarget(targetId)) {
        if ((await this.protected(id))?.uncertain) { await this.stop('suspect-write-outcome-unknown'); return false; }
        noTargetSourceIds.push(String(id));
        continue;
      }
      const record = await getRecord(id);
      try {
        const result = await this.observe(record, id, targetId, await this.expectedFor(record, id));
        if (!result.verified) return false;
      } catch (e) {
        if (wixAuth.isRunInterruption(e)) throw e;
        await this.stop(e.code || 'unknown-reconciliation');
        return false;
      }
    }
    await this.mutate((g, e) => {
      e.reconciledInterval = { ...e.suspectInterval, noTargetSourceIds };
      e.suspectInterval = null;
      e.status = 'passed';
      e.stopReason = null;
    });
    return true;
  }
}
const noTarget = id => id === undefined || id === null || id === '' || id === 'undefined';
function operatorActions(gate) {
  const rows = [];
  for (const [runId, run] of Object.entries(gate.runs)) for (const [entity, item] of Object.entries(run.entities || {})) {
    if (item.supersededBy && gate.runs[item.supersededBy]?.entities?.[entity]) continue;
    if (item.gated === false && !Object.hasOwn(C.DOMAINS, entity)) { declaration(entity, item); continue; }
    // A run that wrote nothing of this entity defers to the runs that did. With no such
    // run anywhere the entity was never gated, and it still blocks (not attempted is never success).
    if (item.stopReason === 'not-run-no-writes' && Object.entries(gate.runs).some(([id, other]) => id !== runId && other.entities?.[entity] && other.entities[entity].stopReason !== 'not-run-no-writes' && !(other.entities[entity].supersededBy && gate.runs[other.entities[entity].supersededBy]?.entities?.[entity]))) continue;
    const prompt = `Requires Import Operator: In the migration project, resume read-back verification for ${entity} in run ${runId}; inspect execution/read-back-gate.json. Resolve the named mapping/credential/coverage finding; for media settlement wait and resume reads of confirmed ids without rewriting. Regenerate the completion report.`;
    if (item.status !== 'passed' || !item.endOfRunVerified) rows.push({
      code: 'read-back-gate-stopped',
      severity: 'critical',
      entity,
      affectedCount: item.canaries?.length || 0,
      action: prompt,
      deadlineReason: item.status === 'passed' && !item.canaries?.length && item.heldRecords?.count ? 'Before DNS change or launch: every record is held by the builder; nothing was imported' : 'Before DNS change or launch: entity import is unverified'
    });
    for (const listed of item.listed || []) rows.push({
      code: 'read-back-listed-canary',
      severity: 'high',
      entity,
      affectedCount: 1,
      action: `${prompt} Resolve listed canary ${listed.sourceId} (${listed.reason}).`,
      deadlineReason: 'Before DNS change or launch: this canary remains unresolved'
    });
    if (item.suspectInterval) rows.push({
      code: 'read-back-suspect-interval',
      severity: 'critical',
      entity,
      affectedCount: item.suspectInterval.count,
      action: `Requires Import Operator: Run read-only reconciliation for ${entity} records ${item.suspectInterval.fromIndex}–${item.suspectInterval.toIndex}, then regenerate the completion report.`,
      deadlineReason: 'Before DNS change or launch: sampled records may lack intended data'
    });
    if (item.heldRecords?.count) rows.push({
      code: 'read-back-held-records',
      severity: 'high',
      entity,
      affectedCount: item.heldRecords.count,
      action: `Requires Import Operator: In the migration project, ${item.heldRecords.count} ${entity} records are held by the builder and were not attempted (${Object.entries(item.heldRecords.reasons).slice(0, 10).map(([r, n]) => `${r}: ${n}`).join(', ')}${Object.keys(item.heldRecords.reasons).length > 10 ? ', …' : ''}); execution/read-back-inventory/${entity}.json lists each. Resolve the named decisions, re-run inventory and validate, then resume.`,
      deadlineReason: 'Before DNS change or launch: held records are not imported'
    });
    if (item.approvedOmissions?.some(o => o.merchantAcknowledgement?.status !== 'acknowledged')) rows.push({
      code: 'read-back-omission-ack',
      severity: 'high',
      entity,
      affectedCount: item.approvedOmissions.every(o=>o.affectedScope?.sourceIdsComplete && Array.isArray(o.affectedScope.sourceIds))
        ? new Set(item.approvedOmissions.flatMap(o=>o.affectedScope.sourceIds)).size
        : item.approvedOmissions.some(o=>o.recordCount==null) || item.approvedOmissions.length>1 && item.approvedOmissions.some(o=>o.affectedScope)
          ? null : Math.max(...item.approvedOmissions.map(o => o.recordCount)),
      action: `Tell the merchant these fields were not migrated: ${item.approvedOmissions.slice(0, 10).map(o => o.path).join(', ')}${item.approvedOmissions.length > 10 ? `, and ${item.approvedOmissions.length - 10} more (${item.approvedOmissions.length} locations; ${(item.pendingAcknowledgementRequest?.artifactRefs || []).some(r => r?.path === approval.evidencePath(entity, item.pendingAcknowledgementRequest.requestId)) ? approval.evidencePath(entity, item.pendingAcknowledgementRequest.requestId) : `execution/read-back-gate.json ${entity} approvedOmissions`} lists each)` : ''}. Requires Import Operator: In the migration project, run replatform answer --project <project> ${item.approvedOmissions[0].merchantAcknowledgement?.requestId || '<request-id>'} --acknowledge --note '<who acknowledged and when>'; regenerate completion.`,
      deadlineReason: 'Before DNS change or launch: merchant acknowledgement required'
    });
  }
  return rows;
}
// The gate sequence for one gated entity, owned by the toolkit so generated code does
// not wire it by hand. Generated code supplies the reviewed builder, the gate's entity options
// (marker, variants, read, lookup, repair) and the writer:
//   write(record, expected)  -> one record's confirmed write ({ id|targetId, findings }) or
//                               exactly { deferred: true, reason } before anything was sent;
//   writeBatch(records)      -> optional; [{ sourceId, targetId, findings }] for the non-canary
//                               records (a bulk writer). Defaults to write() per record.
// Order, as rp-import-codegen describes it: load the inventory and prepare; reconcile a suspect
// interval carried from an earlier run; settle canaries an earlier run sent and the target refused
// with a readable 4xx (never created, so written again); canaries; then the remaining records in
// stable source order, sampled at every 200th and the last landed record; a failed sample stops
// new batches until reconcileInterval clears it. Gate rules are unchanged.
const NOT_CREATED = row => row?.status === 'failed_terminal' && !row.targetId && Number.isInteger(row.failure?.httpStatus) && row.failure.httpStatus >= 400 && row.failure.httpStatus < 500 && ![408, 429].includes(row.failure.httpStatus);
async function runGatedEntity({
  records,
  sourceIdOf = record => String(record.id),
  sourceKeyOf,
  writeBatch,
  batchSize = 200,
  targetIdFor,
  ...options
} = {}) {
  if (!Array.isArray(records)) throw new Error('runGatedEntity requires records');
  if (!Number.isInteger(batchSize) || batchSize < 1 || 200 % batchSize !== 0) throw new Error('runGatedEntity batchSize must divide the 200-record sample interval');
  const gate = new ReadBackGate(options),
    entity = options.entity;
  const byId = new Map(records.map(record => [String(sourceIdOf(record)), record]));
  const getRecord = async id => {
    const record = byId.get(String(id));
    if (!record) throw problem('gated-record-not-in-input');
    return record;
  };
  const result = (status, extra = {}) => ({ entity, status, ...extra });
  return gate.withWriteTracking(async () => {
  const inv = await state.readJson(options.projectDir, `execution/read-back-inventory/${entity}.json`, null);
  if (!inv) {
    await gate.stop('read-back-inventory-missing');
    return result('stopped', { stopReason: 'read-back-inventory-missing', written: [] });
  }
  try {
    await gate.prepare(inv);
  } catch (e) {
    return result('stopped', { stopReason: e.code || 'gate-prepare-failed', errors: e.errors, written: [] });
  }
  const landed = new Map();
  const targetOf = async id => landed.get(String(id)) || (targetIdFor && await targetIdFor(String(id))) || (await gate.protected(String(id)))?.targetId;
  let item = await gate.item();
  if (item.suspectInterval && !(await gate.reconcileInterval(getRecord, targetOf))) return result('stopped', { stopReason: (await gate.item()).stopReason || 'suspect-reconciliation-required', written: [] });
  if (sourceKeyOf) {
    const { rows } = await require('./local-state').loadAttemptJournal(options.projectDir).catch(e => { if (e.code === 'ENOENT') return { rows: [] }; throw e; });
    const latest = new Map();
    for (const row of rows) latest.set(row.sourceStableKey, row);
    for (const id of item.schedule.canarySourceIds || []) {
      const prior = await gate.protected(id), row = latest.get(sourceKeyOf(String(id)));
      if (prior && !prior.targetId && prior.uncertain === true && prior.outcome !== 'not-sent' && NOT_CREATED(row)) await gate.protect(id, { uncertain: false, sentAt: null, outcome: 'not-sent', notSentReason: `target-rejected-${row.failure.httpStatus}:${row.attemptId}` });
    }
  }
  if (!(await gate.executeCanaries(getRecord))) {
    item = await gate.item();
    return result(item.status, { stopReason: item.stopReason, written: [] });
  }
  item = await gate.item();
  const canaries = new Set((item.schedule.canarySourceIds || []).map(String));
  for (const c of item.canaries || []) if (c.targetId) landed.set(String(c.sourceId), c.targetId);
  // Stable source order is the inventory's; held records are never written.
  const order = inv.records.filter(r => !r.held && byId.has(String(r.sourceId))).map(r => String(r.sourceId));
  const position = new Map(order.map((id, i) => [id, i + 1]));
  const rest = order.filter(id => !canaries.has(id));
  const written = [];
  const writeOne = async record => {
    const expected = await gate.expectedFor(record, sourceIdOf(record));
    const out = await gate.timeWrite(() => options.write(record, expected));
    if (out?.deferred === true) return { sourceId: String(sourceIdOf(record)), deferred: true, reason: out.reason };
    return { sourceId: String(sourceIdOf(record)), targetId: writtenTargetId(entity, out), findings: out?.findings };
  };
  // Batches never cross a 200-record sample boundary of the source order, so a failed sample
  // stops every record after it (canaries leave gaps, so slicing `rest` alone would not align).
  const batches = [];
  for (const id of rest) {
    const window = Math.floor((position.get(id) - 1) / 200), last = batches.at(-1);
    if (last && last.window === window && last.ids.length < batchSize) last.ids.push(id);
    else batches.push({ window, ids: [id] });
  }
  let lastLanded = null;
  for (const [batchIndex, { ids }] of batches.entries()) {
    const batch = await Promise.all(ids.map(getRecord));
    const outcomes = writeBatch ? await gate.timeWrite(() => writeBatch(batch)) : [];
    if (!writeBatch) for (const record of batch) outcomes.push(await writeOne(record));
    const isFinalBatch = batchIndex === batches.length - 1;
    const confirmed = (outcomes || []).filter(o => o && o.targetId && byId.has(String(o.sourceId)));
    for (const o of outcomes || []) if (o) written.push(o);
    for (const o of confirmed) landed.set(String(o.sourceId), String(o.targetId));
    for (const [n, o] of confirmed.entries()) {
      const id = String(o.sourceId), isLast = isFinalBatch && n === confirmed.length - 1;
      const sample = await gate.verifySample({ record: await getRecord(id), sourceId: id, targetId: String(o.targetId), index: position.get(id), isLast, findings: o.findings });
      if (isLast) lastLanded = id;
      if (!sample.skipped && !sample.verified) {
        if (!(await gate.reconcileInterval(getRecord, targetOf))) {
          item = await gate.item();
          return result(item.status, { stopReason: item.stopReason || 'read-back-sample-failed', written });
        }
      }
    }
  }
  // Every non-canary record landed earlier, or none remained: the end-of-run check reads the last
  // landed record in source order, so a resume still verifies the entity's tail.
  if (!lastLanded) {
    const tail = [...order].reverse().find(id => landed.has(id));
    if (tail && !canaries.has(tail)) await gate.verifySample({ record: await getRecord(tail), sourceId: tail, targetId: landed.get(tail), index: position.get(tail), isLast: true });
    else if (tail) await gate.mutate((g, e) => { e.endOfRunVerified = e.canaries.find(c => String(c.sourceId) === tail)?.outcome === 'verified'; });
    // Nothing landed (every write deferred): no claim either way; prepare's own rule stands.
  }
  item = await gate.item();
  return result(item.status, { stopReason: item.stopReason || null, endOfRunVerified: item.endOfRunVerified === true, written });
  });
}
module.exports = {
  ReadBackGate,
  declaration,
  operatorActions,
  runGatedEntity
};
