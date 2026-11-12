'use strict';

// A capability is enabled by payload and read-back evidence for this exact page family.
// Served support is a separate post-frontend result, never inferred from a successful write.
function validateCapability(row) {
  if (!row || typeof row !== 'object' || !row.family || !row.frontendType) throw new Error('route capability needs family and frontendType');
  if (row.supported) {
    for (const key of ['key', 'pageIdentifier', 'pageIdentifierType', 'variable', 'readMethod', 'writeMethod', 'evidence']) {
      if (typeof row[key] !== 'string' || !row[key]) throw new Error(`supported route capability ${row.family} missing ${key}`);
    }
    if (!['tpaPageId', 'pageId'].includes(row.pageIdentifierType)) throw new Error('unsupported pageIdentifierType');
    if (!row.request || row.request.urlMapping?.pageIdentifier !== row.pageIdentifier || row.request.urlMapping?.pageIdentifierType !== row.pageIdentifierType || !row.readBackFixture || row.readBackFixture.pageIdentifier !== row.pageIdentifier || row.readBackFixture.mapping !== row.request.urlMapping.mapping) {
      throw new Error(`supported route capability ${row.family} needs matching request and read-back fixture`);
    }
  }
  return row;
}

function inspectRoute(source, capability, existing) {
  validateCapability(capability);
  if (!source || source.family !== capability.family || !source.pattern) throw new Error('route source needs matching family and pattern');
  if (!capability.supported) return { ...source, status: 'unverified', reason: capability.reason || 'missing-adapter-evidence' };
  if (!source.pattern.includes(`{{${capability.variable}}}`) || /[?#]/.test(source.pattern)) {
    return { ...source, status: 'unverified', reason: 'unsupported-source-pattern' };
  }
  if (existing && existing.owner && existing.owner !== capability.key) {
    return { ...source, status: 'conflict', reason: 'occupied-address', existing };
  }
  if (existing && existing.mapping === source.pattern && existing.pageIdentifier === capability.pageIdentifier) {
    return { ...source, status: 'reused', readBack: existing, served: false };
  }
  if (existing && existing.mapping && existing.mapping !== source.pattern) {
    return { ...source, status: 'conflict', reason: 'different-existing-mapping', existing };
  }
  return { ...source, status: 'write-required', existing: existing || null, served: false };
}

async function configureRoute(plan, capability, transport) {
  if (plan.status !== 'write-required') return plan;
  validateCapability(capability);
  if (!capability.supported) throw new Error('unsupported capability cannot write');
  if (!transport || typeof transport.write !== 'function' || typeof transport.read !== 'function') throw new Error('route transport needs write and read');
  const payload = {
    key: capability.key,
    urlMapping: {
      key: capability.key,
      pageIdentifier: capability.pageIdentifier,
      pageIdentifierType: capability.pageIdentifierType,
      mapping: plan.pattern,
    },
  };
  await transport.write(payload, capability, { mode: plan.existing ? 'update' : 'create' });
  const readBack = await transport.read(capability.key, capability);
  if (!readBack || readBack.mapping !== plan.pattern || readBack.pageIdentifier !== capability.pageIdentifier) {
    return { ...plan, status: 'readback-failed', payload, readBack: readBack || null, served: false };
  }
  return { ...plan, status: 'configured', payload, readBack, served: false };
}

function expectedPath(pattern, slug) {
  if (!pattern || typeof slug !== 'string' || !slug || !pattern.includes('{{slug}}')) throw new Error('read-back pattern and slug required');
  const path = `/${pattern.replace(/^\/+/, '').replace('{{slug}}', encodeURIComponent(slug))}`;
  if (path.includes('{{')) throw new Error('unresolved route variable');
  return path;
}

function verifyServedRoute(result, check) {
  if (!['configured', 'reused'].includes(result.status)) return result;
  if (!check || !check.deploymentId || !check.targetRecordId || !check.path || !check.identityMatched || !check.generatedUrlMatched) {
    return { ...result, served: false, servedReason: check && check.reason || 'route-identity-unverified' };
  }
  return { ...result, served: true, servedEvidence: check };
}

module.exports = { validateCapability, inspectRoute, configureRoute, expectedPath, verifyServedRoute };
