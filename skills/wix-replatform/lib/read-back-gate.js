'use strict';

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
const {
  deriveImportedOrderId
} = require('../resources/rp-target-wix/lib/order-history');
const {
  findMatching
} = require('../resources/rp-target-wix/lib/contact-import');
const approval = require('./read-back-approval');
const API = 'https://www.wixapis.com';
const readSessions = new Map();
function sharedReads(projectDir, runId, wix) {
  const key = `${path.resolve(projectDir)}\0${runId}`;
  if (!readSessions.has(key)) readSessions.set(key, new ReadBackReads(wix));
  return readSessions.get(key);
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
    const previousRun = Object.entries(history.runs).reverse().find(([id, run]) => id !== this.runId && run.entities?.[this.entity] && !run.entities[this.entity].supersededBy);
    const own = await this.item();
    const existing = own?.schedule ? own : previousRun?.[1].entities[this.entity];
    const schedule = C.cover(inv, {
      ceiling: chosen?.value || 10,
      existing: (existing?.canaries || []).map(r => r.sourceId)
    });
    this.repairContractDigest = C.digest({
      bindings: this.validated.bindingDigests,
      code: hashArtifact(this.projectDir, 'src/import'),
      comparator: 1
    });
    this.preparationMs += preparationMs + Math.max(0, this.reads.now() - preparingAt);
    await this.mutate((g, item) => {
      if (!own?.schedule && existing) {
        Object.assign(item, structuredClone(existing));
        delete item.supersededBy;
        if (previousRun) g.runs[previousRun[0]].entities[this.entity].supersededBy = this.runId;
      }
      if (existing && C.digest(existing.bindingDigests) !== C.digest(this.validated.bindingDigests)) {
        item.approvedOmissions = [];
        delete item.pendingAcknowledgementRequest;
      }
      item.paths ||= {};
      item.paths.notExercised = this.validated.contract.intendedFields.filter(f => !(this.validated.decision.fieldDispositions || []).some(d => d.status === 'notMigrated' && (d.path || d.targetPath) === f.targetPath)).filter(f => !Object.keys(inv.writePaths).some(p => p === f.targetPath || p.startsWith(f.targetPath + '.') || p.startsWith(f.targetPath + '[]'))).map(f => f.targetPath);
      item.schedule = existing?.schedule?.universeDigest === schedule.universeDigest ? existing.schedule : schedule;
      item.status = 'stopped';
      item.stopReason = schedule.status === 'covered' ? 'canaries-pending' : schedule.status;
      item.retryStats = this.reads.stats;
      item.invocationStartedAt = this.now();
      item.bindingDigests = this.validated.bindingDigests;
      if (!inv.records.length) item.endOfRunVerified = true;
      if (!item.approvedOmissions.length) item.approvedOmissions = (this.validated.decision.fieldDispositions || []).filter(d => d.status === 'notMigrated').map(d => ({
        path: d.path || d.sourcePath || d.targetPath,
        kind: d.kind || 'source',
        recordCount: inv.sourcePaths[d.path || d.sourcePath] || inv.records.length,
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
    return products.filter(p => C.valuesAt(p, marker.path).some(v => v === marker.value));
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
  async observe(record, sourceId, targetId, expected) {
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
    try {
      return await write();
    } finally {
      this.writeMs += Math.max(0, this.reads.now() - started);
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
      // Every declared populated mapping must produce an expected target value; omission from the builder cannot pass silently.
      for (const row of this.validated.rows) if (!prior?.guardDroppedPaths?.includes(row.writePath) && row.sourcePaths.some(p => C.valuesAt(record, p).some(C.populated)) && !C.valuesAt(expected, row.writePath).some(C.populated)) throw problem('builder-missing-intended-field');
      if (prior && !targetId) {
        let found;
        try {
          found = await this.lookup(record, expected, this.reads.wix);
        } catch (e) {
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
      if (!prior) {
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
          targetId = written?.targetId || written?.id || written?.[`${this.entity}Id`] || written?.[this.entity]?.id;
          const guarded = await this.recordGuard(sourceId, written?.findings);
          if (guarded.length) expected = applyGuards(this.entity, expected, guarded);
          if (!targetId) throw problem('unknown-write-no-confirmed-id');
          await this.protect(sourceId, {
            targetId,
            uncertain: false
          });
          newWrite = true;
        } catch (e) {
          await this.stop(e.code || 'unknown-write-outcome');
          return false;
        }
      }
      let result;
      try {
        result = await this.observe(record, sourceId, targetId, expected);
      } catch (e) {
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
        sourceIds: this.validated.inventory.records.slice(e.lastGoodIndex || 0, index).map(r => r.sourceId)
      };
    });
    return result;
  }
  async reconcileInterval(getRecord, targetIdFor) {
    const item = await this.item();
    for (const id of item.suspectInterval?.sourceIds || []) {
      const record = await getRecord(id);
      try {
        const result = await this.observe(record, id, await targetIdFor(id), await this.expectedFor(record, id));
        if (!result.verified) return false;
      } catch (e) {
        await this.stop(e.code || 'unknown-reconciliation');
        return false;
      }
    }
    await this.mutate((g, e) => {
      e.reconciledInterval = e.suspectInterval;
      e.suspectInterval = null;
      e.status = 'passed';
      e.stopReason = null;
    });
    return true;
  }
}
function operatorActions(gate) {
  const rows = [];
  for (const [runId, run] of Object.entries(gate.runs)) for (const [entity, item] of Object.entries(run.entities || {})) {
    if (item.supersededBy && gate.runs[item.supersededBy]?.entities?.[entity]) continue;
    if (item.gated === false && !Object.hasOwn(C.DOMAINS, entity)) { declaration(entity, item); continue; }
    const prompt = `Requires Import Operator: In the migration project, resume read-back verification for ${entity} in run ${runId}; inspect execution/read-back-gate.json. Resolve the named mapping/credential/coverage finding; for media settlement wait and resume reads of confirmed ids without rewriting. Regenerate the completion report.`;
    if (item.status !== 'passed' || !item.endOfRunVerified) rows.push({
      code: 'read-back-gate-stopped',
      severity: 'critical',
      entity,
      affectedCount: item.canaries?.length || 0,
      action: prompt,
      deadlineReason: 'Before DNS change or launch: entity import is unverified'
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
    if (item.approvedOmissions?.some(o => o.merchantAcknowledgement?.status !== 'acknowledged')) rows.push({
      code: 'read-back-omission-ack',
      severity: 'high',
      entity,
      affectedCount: Math.max(...item.approvedOmissions.map(o => o.recordCount)),
      action: `Tell the merchant these fields were not migrated: ${item.approvedOmissions.map(o => o.path).join(', ')}. Requires Import Operator: In the migration project, run replatform answer --project <project> ${item.approvedOmissions[0].merchantAcknowledgement?.requestId || '<request-id>'} --acknowledge --note '<who acknowledged and when>'; regenerate completion.`,
      deadlineReason: 'Before DNS change or launch: merchant acknowledgement required'
    });
  }
  return rows;
}
module.exports = {
  ReadBackGate,
  declaration,
  operatorActions
};
